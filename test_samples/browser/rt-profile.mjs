/**
 * Real time playback profile (runs in a real browser via scripts/browser-bench.mjs).
 *
 * The offline benchmarks (app-ab.mjs, sf2-perf-compare.mjs) measure how long a
 * song takes to *render*. That is not what stutters: a real AudioContext has a
 * hard deadline per render quantum, the main thread competes with everything
 * else, and notes have to be scheduled before their start time - not after.
 *
 * This page plays the song for real with both SF2 engines and records:
 *   - how much main thread time each note-on costs (createNote), p95 / max
 *   - the playhead lag when a note is created (negative = the note is already
 *     late when it is handed to Web Audio)
 *   - every AudioScheduledSource.start() whose time is already in the past
 *   - main thread long tasks (PerformanceObserver 'longtask')
 *   - live Web Audio nodes, AudioBuffers and bytes over time
 *   - PicoAudio's own overload gauge (states.latencyTime)
 * plus the offline render time of the same segment, so the two can be compared.
 *
 * Usage: node scripts/browser-bench.mjs <font.sf2> <song.mid> --page=rt-profile
 *   query: secs=12 engines=webaudio,dsp start=0 offline=1
 */
import PicoAudio from '/lib/PicoAudio/src/main.js';
import { isSF2WorkletReady } from '/lib/PicoAudio/src/player/sound-source/sf2-worklet-renderer.js';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; };
const SECS = Number(params.get('secs') || 12);
const ENGINES = (params.get('engines') || 'webaudio,dsp').split(',').filter(Boolean);
const START = Number(params.get('start') || 0);
const OFFLINE = params.get('offline') !== '0';
/**
 * Experiment only: keep every AudioBufferSourceNode's playbackRate at exactly
 * 1 (Chrome's non-interpolating fast path) and swallow the engine's writes.
 * The pitch is then wrong on purpose - this measures how much of the engine's
 * audio thread cost is the interpolated sample path.
 */
const FORCE_UNIT_RATE = params.get('forceunit') === '1';
/** Temporary ablation bitmask for the engine (see sf2-webaudio-renderer.js). */
const ABLATE = Number(params.get('ablate') || 0);
/** Pin the player's note lookahead (ms) instead of letting it adapt. */
const FORCE_BUF = Number(params.get('buf') || 0);
/**
 * Busy-wait this many ms per animation frame, i.e. what the app's piano roll
 * costs the main thread. Used to see whether a loaded main thread makes the
 * player miss notes.
 */
const JANK_MS = Number(params.get('jank') || 0);
const results = { ua: navigator.userAgent, info: {}, engines: {} };

/**
 * Transition log for the driver's CPU probe: performance.now() is relative to
 * navigation, __RT_EPOCH__ maps it onto the driver's wall clock so the whole
 * Chrome process tree's CPU can be attributed to a playback window (the audio
 * thread is not on this page's main thread, so this is the only way to see it).
 */
window.__RT_EPOCH__ = Date.now() - performance.now();
window.__RT_LOG__ = [];
function rtMark(phase, engine, seconds) {
    window.__RT_LOG__.push({ phase, engine, seconds, wall: performance.now() });
}

/* ------------------------------------------------------- instrumentation -- */

const kindOf = new WeakMap();
const liveSet = new Set();
/** Scheduled source -> its [start, stop) window, to count what is really playing. */
const sourceWindows = new Map();
const inst = {
    active: false, ctx: null, app: null,
    created: {}, createdTotal: 0, disconnected: 0, live: 0, peakLive: 0, liveByKind: {},
    buffers: 0, bufferBytes: 0, peakBufferBytes: 0,
    starts: [], longtasks: [], jank: [], samples: [], noteMs: [], scheduleLag: [],
    timers: [], intervals: [],
    events: [], wall0: 0,
};

function resetInst() {
    Object.assign(inst, {
        active: false, ctx: null, app: null,
        created: {}, createdTotal: 0, disconnected: 0, live: 0, peakLive: 0, liveByKind: {},
        buffers: 0, bufferBytes: 0, peakBufferBytes: 0,
        starts: [], longtasks: [], jank: [], samples: [], noteMs: [], scheduleLag: [],
        timers: [], intervals: [],
        events: [], wall0: 0,
    });
    liveSet.clear();
}

const ctxProto = BaseAudioContext.prototype;
const FACTORIES = {
    createGain: 'gain', createBufferSource: 'source', createBiquadFilter: 'filter',
    createOscillator: 'oscillator', createWaveShaper: 'shaper', createChannelMerger: 'merger',
    createStereoPanner: 'panner', createPanner: 'panner', createDelay: 'delay',
    createConvolver: 'convolver', createDynamicsCompressor: 'compressor',
};
for (const [name, kind] of Object.entries(FACTORIES)) {
    const orig = ctxProto[name];
    if (typeof orig !== 'function') continue;
    ctxProto[name] = function (...args) {
        const node = orig.apply(this, args);
        if (inst.active) {
            inst.created[kind] = (inst.created[kind] || 0) + 1;
            inst.createdTotal++;
            kindOf.set(node, kind);
        }
        return node;
    };
}

const origCreateBuffer = ctxProto.createBuffer;
ctxProto.createBuffer = function (channels, length, rate) {
    const buffer = origCreateBuffer.call(this, channels, length, rate);
    if (inst.active) {
        inst.buffers++;
        inst.bufferBytes += length * channels * 4;
        inst.peakBufferBytes = Math.max(inst.peakBufferBytes, inst.bufferBytes);
    }
    return buffer;
};

if (FORCE_UNIT_RATE) {
    const origSource = ctxProto.createBufferSource;
    ctxProto.createBufferSource = function (...args) {
        const source = origSource.apply(this, args);
        // writes go into a dummy param, the real one stays 1.0
        Object.defineProperty(source, 'playbackRate', {
            configurable: true,
            value: {
                value: 1,
                setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {},
                setTargetAtTime() {}, cancelScheduledValues() {}, setValueCurveAtTime() {},
            },
        });
        return source;
    };
}

const origConnect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (...args) {
    if (inst.active && kindOf.has(this) && !liveSet.has(this)) {
        liveSet.add(this);
        inst.live++;
        const kind = kindOf.get(this);
        inst.liveByKind[kind] = (inst.liveByKind[kind] || 0) + 1;
        inst.peakLive = Math.max(inst.peakLive, inst.live);
    }
    return origConnect.apply(this, args);
};
const origDisconnect = AudioNode.prototype.disconnect;
AudioNode.prototype.disconnect = function (...args) {
    if (liveSet.delete(this)) {
        inst.live--;
        inst.disconnected++;
        const kind = kindOf.get(this);
        inst.liveByKind[kind] = (inst.liveByKind[kind] || 0) - 1;
    }
    return origDisconnect.apply(this, args);
};

// Blink installs start()/stop() on each concrete interface, so patching only
// AudioScheduledSourceNode.prototype silently missed every AudioBufferSource.
for (const Ctor of [window.AudioScheduledSourceNode, window.AudioBufferSourceNode,
    window.OscillatorNode, window.ConstantSourceNode]) {
    const proto = Ctor && Ctor.prototype;
    if (!proto || !Object.prototype.hasOwnProperty.call(proto, 'start')) continue;
    const origStart = proto.start;
    proto.start = function (when, ...rest) {
        if (inst.active) {
            const now = inst.ctx ? inst.ctx.currentTime : 0;
            const at = typeof when === 'number' ? when : now;
            inst.starts.push((now - at) * 1000);   // >0: scheduled in the past
            sourceWindows.set(this, { start: at, stop: Infinity, kind: kindOf.get(this) });
        }
        return origStart.apply(this, [when, ...rest]);
    };
    const origStop = proto.stop;
    proto.stop = function (when, ...rest) {
        const w = sourceWindows.get(this);
        if (w) w.stop = typeof when === 'number' ? when : (inst.ctx ? inst.ctx.currentTime : 0);
        return origStop.apply(this, [when, ...rest]);
    };
}

try {
    new PerformanceObserver((list) => {
        if (!inst.active) return;
        for (const entry of list.getEntries()) {
            inst.longtasks.push(entry.duration);
            inst.events.push({ t: entry.startTime - inst.wall0, kind: 'longtask', ms: entry.duration });
        }
    }).observe({ entryTypes: ['longtask'] });
} catch (e) { /* longtask not supported */ }

function stat(values) {
    if (!values.length) return { n: 0, mean: 0, p50: 0, p95: 0, max: 0, min: 0, sum: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
        n: sorted.length,
        mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], min: sorted[0],
        sum: sorted.reduce((a, b) => a + b, 0),
    };
}

/* --------------------------------------------------------------- sources -- */

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
// parseSMF copies a Uint8Array but *views* an ArrayBuffer (and overwrites the
// data in place), so hand it a typed array or the first parse destroys the song.
const midiAb = new Uint8Array(await (await fetch('/__song.mid')).arrayBuffer());

// How dense is this song, and where? (notes in flight, 1s buckets)
function density(playData) {
    const events = [];
    let end = 0;
    for (const channel of playData.channels) {
        for (const note of channel.notes) {
            events.push([note.startTime, 1], [note.stopTime, -1]);
            end = Math.max(end, note.stopTime);
        }
    }
    events.sort((a, b) => a[0] - b[0]);
    let cur = 0, best = 0, bestAt = 0;
    const peakPerSecond = new Array(Math.ceil(end) + 1).fill(0);
    for (let i = 0; i < events.length; i++) {
        const [t, d] = events[i];
        cur += d;
        if (cur > best) { best = cur; bestAt = t; }
        // hold this level until the next event
        const next = events[i + 1] ? events[i + 1][0] : t;
        if (next > t) {
            const to = Math.ceil(next);
            for (let s = Math.floor(t); s < to && s < peakPerSecond.length; s++) {
                peakPerSecond[s] = Math.max(peakPerSecond[s], cur);
            }
        }
    }
    const busiest = [...peakPerSecond.keys()]
        .sort((a, b) => peakPerSecond[b] - peakPerSecond[a]).slice(0, 6)
        .map((s) => ({ s, voices: peakPerSecond[s] })).sort((a, b) => a.s - b.s);
    return { peakVoices: best, peakAt: bestAt, peakPerSecond, busiest };
}

/* ------------------------------------------------------------------ runs -- */

async function runRealtime(engine, seconds) {
    // 'none' measures what the page itself costs during the window (timers,
    // instrumentation, GC) so engine numbers can be read as a delta.
    if (engine === 'none') {
        resetInst();
        inst.active = true;
        rtMark('playing', engine, seconds);
        await new Promise((r) => setTimeout(r, seconds * 1000));
        rtMark('done', engine, seconds);
        inst.active = false;
        resetInst();
        return { notes: 0, elapsedMs: seconds * 1000 };
    }
    resetInst();
    const app = new PicoAudio({ sf2Engine: engine, soundQuality: 4, isSkipBeginning: false });
    if (ABLATE) app.settings.sf2Ablate = ABLATE;
    if (params.get('nobake') === '1') app.settings.sf2Bake = false;
    if (params.get('quality')) app.settings.sf2Quality = params.get('quality');
    if (params.get('interp')) app.settings.sf2Interpolation = params.get('interp');
    if (params.get('nodspchain') === '1') {
        app.settings.isReverb = false;
        app.settings.isChorus = false;
    }
    app.init();
    inst.ctx = app.context;
    inst.app = app;
    await app.context.resume().catch(() => {});
    app.loadSF2(fontAb);
    const parsed = app.parseSMF(midiAb);
    app.setData(parsed);
    // the worklet engine loads its module asynchronously - wait for it so the
    // measurement covers the real engine instead of the DSP fallback
    if (engine === 'worklet') {
        app.prepareSF2Worklet();
        for (let i = 0; i < 200 && !isSF2WorkletReady(app.context); i++) {
            await new Promise((r) => setTimeout(r, 50));
        }
        if (!isSF2WorkletReady(app.context)) throw new Error('worklet engine did not become ready');
    }

    // wrap note-on so its main thread cost and the playhead lag are measured
    const origCreateNote = app.createNote.bind(app);
    const origCreatePerc = app.createPercussionNote.bind(app);
    const wrap = (fn) => (option) => {
        const t0 = performance.now();
        const stopFunc = fn(option);
        inst.noteMs.push(performance.now() - t0);
        inst.scheduleLag.push(((app.context.currentTime - app.states.startTime) - option.startTime) * 1000);
        return stopFunc;
    };
    app.createNote = wrap(origCreateNote);
    app.createPercussionNote = wrap(origCreatePerc);

    inst.active = true;
    const wall0 = performance.now();
    inst.wall0 = wall0;
    const ctx0 = app.context.currentTime;
    let rafId = 0;
    if (JANK_MS) {
        const burn = () => {
            const until = performance.now() + JANK_MS;
            while (performance.now() < until) { /* like drawing a piano roll */ }
            rafId = requestAnimationFrame(burn);
        };
        burn();
    }
    app.play();
    rtMark('playing', engine, seconds);
    if (FORCE_BUF) {
        app.states.updateBufTime = FORCE_BUF;
        app.states.updateBufMaxTime = FORCE_BUF;
    }
    if (START > 0) app.setStartTime(START);

    // main thread jank: a 20ms heartbeat that has to be serviced on the same
    // event loop the player schedules notes from
    let jankPrev = performance.now() + 20;
    const janker = setInterval(() => {
        const now = performance.now();
        const drift = now - jankPrev;
        jankPrev = now + 20;
        if (drift > 40) {
            inst.jank.push(drift);
            inst.events.push({ t: now - wall0, kind: 'jank', ms: drift });
        }
    }, 20);

    const sampler = setInterval(() => {
        if (FORCE_BUF) {
            app.states.updateBufTime = FORCE_BUF;
            app.states.updateBufMaxTime = FORCE_BUF;
        }
        const now = app.context.currentTime;
        let playing = 0;
        for (const w of sourceWindows.values()) {
            if (w.start <= now && now < w.stop) playing++;
        }
        inst.samples.push({
            t: app.context.currentTime - ctx0,
            latency: app.states.latencyTime,
            bufTime: app.states.updateBufTime,
            stopFuncs: app.states.stopFuncs.length,
            live: inst.live, created: inst.createdTotal, buffers: inst.buffers,
            bufferBytes: inst.bufferBytes,
            liveByKind: { ...inst.liveByKind },
            playing,
            notes: inst.noteMs.length, jsMs: inst.noteMs.reduce((a, b) => a + b, 0),
        });
    }, 100);

    // Audio thread load, straight from Chrome's AudioRenderCapacity (underruns
    // and peak load are exactly what "offline render was fast but playback
    // stutters" cannot show).
    const capacity = { available: false, load: [], peak: [], underruns: [], quantums: [] };
    try {
        if (app.context.renderCapacity) {
            capacity.available = true;
            app.context.renderCapacity.onupdate = (e) => {
                capacity.load.push(e.averageLoad);
                capacity.peak.push(e.peakLoad);
                capacity.underruns.push(e.underrunRatio);
                capacity.quantums.push(e.numberOfFramesToRender || 0);
            };
            await app.context.renderCapacity.start({ updateInterval: 0.25 });
        }
    } catch (e) {
        capacity.error = `${e.name}: ${e.message}`;
    }

    // Time every timer / interval callback the player runs (the SF2 streaming
    // pump and the 1ms note scheduler both live there). Installed after our own
    // sampler so it never measures itself.
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...rest) {
        if (typeof fn !== 'function') return origSetTimeout.call(window, fn, delay, ...rest);
        const wrapped = function (...a) {
            const t = performance.now();
            try { return fn.apply(this, a); }
            finally {
                const ms = performance.now() - t;
                inst.timers.push(ms);
                if (ms > 10) inst.events.push({ t: t - inst.wall0, kind: 'timer', ms });
            }
        };
        return origSetTimeout.call(window, wrapped, delay, ...rest);
    };
    const origSetInterval = window.setInterval;
    window.setInterval = function (fn, delay, ...rest) {
        if (typeof fn !== 'function') return origSetInterval.call(window, fn, delay, ...rest);
        const wrapped = function (...a) {
            const t = performance.now();
            try { return fn.apply(this, a); }
            finally {
                const ms = performance.now() - t;
                inst.intervals.push(ms);
                if (ms > 10) inst.events.push({ t: t - inst.wall0, kind: 'interval', ms });
            }
        };
        return origSetInterval.call(window, wrapped, delay, ...rest);
    };

    await new Promise((r) => origSetTimeout.call(window, r, seconds * 1000));
    window.setTimeout = origSetTimeout;
    window.setInterval = origSetInterval;
    const wallMs = performance.now() - wall0;
    const audioMs = (app.context.currentTime - ctx0) * 1000;
    app.stop();
    rtMark('done', engine, seconds);
    if (rafId) cancelAnimationFrame(rafId);
    clearInterval(sampler);
    clearInterval(janker);
    try { if (capacity.available) app.context.renderCapacity.stop(); } catch (e) { /* noop */ }
    inst.active = false;

    const lag = stat(inst.scheduleLag);
    const starts = stat(inst.starts);
    const lateStarts = inst.starts.filter((v) => v > 1);
    const samples = inst.samples;
    // note-on counts and JS time are cumulative; accumulate deltas per second
    const perSecond = [];
    let prevNotes = 0, prevJs = 0;
    for (const s of samples) {
        const sec = Math.floor(s.t);
        let row = perSecond[sec];
        if (!row) row = perSecond[sec] = { sec, notes: 0, jsMs: 0, peakLive: 0, stopFuncs: 0, bufferMB: 0 };
        row.notes += s.notes - prevNotes;
        row.jsMs += s.jsMs - prevJs;
        row.peakLive = Math.max(row.peakLive, s.live);
        row.stopFuncs = Math.max(row.stopFuncs, s.stopFuncs);
        row.bufferMB = Math.max(row.bufferMB, s.bufferBytes / 1048576);
        prevNotes = s.notes; prevJs = s.jsMs;
    }
    const rec = {
        wallMs, audioMs,
        notes: inst.noteMs.length,
        noteMs: stat(inst.noteMs),
        scheduleLagMs: lag,
        lateNoteCount: inst.scheduleLag.filter((v) => v > 1).length,
        starts: starts, lateStarts: lateStarts.length,
        lateStartMaxMs: lateStarts.length ? Math.max(...lateStarts) : 0,
        longtasks: stat(inst.longtasks),
        jank: stat(inst.jank),
        timerMs: stat(inst.timers),
        intervalMs: stat(inst.intervals),
        capacity: capacity.available ? {
            available: true, samples: capacity.load.length,
            avgLoad: stat(capacity.load), peakLoad: stat(capacity.peak),
            underruns: capacity.underruns, peakUnderrun: Math.max(0, ...capacity.underruns),
            quantums: capacity.quantums.slice(0, 3),
        } : { available: false, error: capacity.error || 'no renderCapacity' },
        events: inst.events.slice(0, 60),
        nodes: { ...inst.created, total: inst.createdTotal, disconnected: inst.disconnected, peakLive: inst.peakLive },
        buffersCreated: inst.buffers, peakBufferBytes: inst.peakBufferBytes,
        peakStopFuncs: Math.max(0, ...samples.map((s) => s.stopFuncs)),
        peakPlayingSources: Math.max(0, ...samples.map((s) => s.playing || 0)),
        playingStats: stat(samples.map((s) => s.playing || 0)),
        peakLiveByKind: Object.fromEntries(Object.keys(inst.liveByKind).map((kind) => [
            kind, Math.max(0, ...samples.map((s) => (s.liveByKind && s.liveByKind[kind]) || 0)),
        ])),
        peakLatency: Math.max(-1e9, ...samples.map((s) => s.latency)),
        peakBufTime: Math.max(0, ...samples.map((s) => s.bufTime)),
        sampleCount: samples.length,
        perSecond: perSecond.filter(Boolean),
    };
    try { await app.context.close(); } catch (e) { /* noop */ }
    resetInst();
    return rec;
}

async function runOffline(engine, seconds) {
    const rate = 44100;
    const frames = Math.round(seconds * rate);
    const ctx = new OfflineAudioContext(2, frames, rate);
    const app = new PicoAudio({ audioContext: ctx, sf2Engine: engine, soundQuality: 4 });
    app.loadSF2(fontAb);
    const parsed = app.parseSMF(midiAb);
    app.setData(parsed);
    // Split the offline render into the JS part (note synthesis / graph build)
    // and the native part (what the audio thread actually has to render).
    let jsMs = 0;
    const wrap = (fn) => (option) => {
        const t = performance.now();
        const stopFunc = fn(option);
        jsMs += performance.now() - t;
        return stopFunc;
    };
    app.createNote = wrap(app.createNote.bind(app));
    app.createPercussionNote = wrap(app.createPercussionNote.bind(app));
    const t0 = performance.now();
    await app.render();
    const total = performance.now() - t0;
    return { total, js: jsMs, native: total - jsMs, realtimeRatio: seconds * 1000 / total };
}

const boot = new PicoAudio({});
boot.init();
const parsedInfo = boot.parseSMF(midiAb);
const dens = density(parsedInfo);
results.info = {
    songNotes: dens ? parsedInfo.channels.reduce((n, c) => n + c.notes.length, 0) : 0,
    lastEventTime: parsedInfo.lastEventTime,
    peakVoices: dens.peakVoices, peakAt: dens.peakAt,
    busiest: dens.busiest,
    seconds: SECS, start: START,
};
await boot.context.close().catch(() => {});
say(`${results.info.songNotes} notes, ${results.info.lastEventTime.toFixed(1)}s, peak ${dens.peakVoices} `
    + `simultaneous voices at ${dens.peakAt.toFixed(1)}s`);
say(`busiest seconds: ${dens.busiest.map((b) => `${b.s}s:${b.voices}`).join(' ')}`);

for (const engine of ENGINES) {
    try {
        const rec = await runRealtime(engine, SECS);
        if (OFFLINE) rec.offline = await runOffline(engine, SECS);
        results.engines[engine] = rec;
        say(`${engine}: ${rec.notes} note-ons, note ${rec.noteMs.p95.toFixed(2)}/${rec.noteMs.max.toFixed(1)}ms (p95/max), `
            + `lag p95 ${rec.scheduleLagMs.p95.toFixed(1)}ms, late ${rec.lateNoteCount}, `
            + `live nodes peak ${rec.nodes.peakLive}, longtasks ${rec.longtasks.n} `
            + `(${rec.longtasks.max.toFixed(0)}ms max), offline ${OFFLINE ? rec.offline.total.toFixed(0) : '-'}ms`);
    } catch (e) {
        results.engines[engine] = { error: `${e.name}: ${e.message}`, stack: e.stack };
        say(`${engine}: FAILED ${e.name}: ${e.message}\n${e.stack}`);
    }
}

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
