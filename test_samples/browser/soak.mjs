/**
 * Memory soak for one SF2 engine, in a real browser.
 *
 * The user reported an out of memory crash after roughly 100000 notes with the
 * DSP engine. A leak of that size cannot be reasoned out of the source, and it
 * cannot be measured in Node either: the streaming renderer depends on real
 * timers and a real audio clock, and a mock clock that advances faster than the
 * pump can synthesize reports every unfinished note as a leak (see
 * scripts/audio-soak-test.mjs).
 *
 * So this page plays a song on a loop for `secs` seconds and samples, every few
 * seconds:
 *   - used JS heap (needs --enable-precise-memory-info, see the usage line)
 *   - live Web Audio nodes, by kind, and live AudioBuffers
 *   - PicoAudio's own note bookkeeping (stopFuncs / noteOnAry / noteOffAry)
 *   - note-ons since the start, so growth can be expressed per 1000 notes
 * then stops playback and drains for a few seconds, to separate "still
 * ringing" from "never freed".
 *
 * Usage: CHROME_FLAGS=--enable-precise-memory-info \
 *        node scripts/browser-bench.mjs <font.sf2> <song.mid> \
 *          --page=soak --query="engine=dsp&secs=300"
 *   engine=dsp|worklet|webaudio   which synthesizer to soak
 *   secs=300                      how long to play (looping the song)
 *   sample=5000                   sampling interval, ms
 *   drain=8                       seconds of silence at the end
 */
import PicoAudio from '/lib/PicoAudio/src/main.js';
import { isSF2WorkletReady } from '/lib/PicoAudio/src/player/sound-source/sf2-worklet-renderer.js';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; };
const ENGINE = params.get('engine') || 'dsp';
const SECS = Number(params.get('secs') || 300);
const SAMPLE_MS = Number(params.get('sample') || 5000);
const DRAIN = Number(params.get('drain') || 8);

const results = { ua: navigator.userAgent, info: { engine: ENGINE, secs: SECS }, samples: [], cases: [] };

/* ------------------------------------------------------- instrumentation -- */

const kindOf = new WeakMap();
const liveSet = new Set();
const stat = {
    created: {}, createdTotal: 0, disconnected: 0, live: 0, peakLive: 0, liveByKind: {},
    buffers: 0, bufferBytes: 0, bufferSizes: {},
    noteOns: 0,
};

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
        stat.created[kind] = (stat.created[kind] || 0) + 1;
        stat.createdTotal++;
        kindOf.set(node, kind);
        return node;
    };
}

const origCreateBuffer = ctxProto.createBuffer;
ctxProto.createBuffer = function (channels, length, rate) {
    const buffer = origCreateBuffer.call(this, channels, length, rate);
    const bytes = length * channels * 4;
    stat.buffers++;
    stat.bufferBytes += bytes;
    // Which chunk lengths are actually allocated: the engine reuses a per
    // length free list, so a length that keeps showing up is a length the list
    // never has a spare for.
    stat.bufferSizes[length] = (stat.bufferSizes[length] || 0) + 1;
    return buffer;
};

const origConnect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (...args) {
    if (kindOf.has(this) && !liveSet.has(this)) {
        liveSet.add(this);
        stat.live++;
        const kind = kindOf.get(this);
        stat.liveByKind[kind] = (stat.liveByKind[kind] || 0) + 1;
        stat.peakLive = Math.max(stat.peakLive, stat.live);
    }
    return origConnect.apply(this, args);
};
const origDisconnect = AudioNode.prototype.disconnect;
AudioNode.prototype.disconnect = function (...args) {
    if (liveSet.delete(this)) {
        stat.live--;
        stat.disconnected++;
        const kind = kindOf.get(this);
        stat.liveByKind[kind] = (stat.liveByKind[kind] || 0) - 1;
    }
    return origDisconnect.apply(this, args);
};

/* ------------------------------------------------------------------ song -- */

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
// parseSMF views an ArrayBuffer and overwrites it in place, so hand it a
// typed array (a second parse would otherwise find a destroyed song).
const midiAb = new Uint8Array(await (await fetch('/__song.mid')).arrayBuffer());

const app = new PicoAudio({ sf2Engine: ENGINE, soundQuality: 4, isSkipBeginning: false });
app.init();
// Loop at the player level, so the soak goes through the same start/stop cycle
// the app uses instead of a hand rolled replay.
app.settings.loop = true;
const context = app.context;
await context.resume().catch(() => {});
if (!app.loadSF2(fontAb)) throw new Error('cannot load soundfont');
app.setData(app.parseSMF(midiAb));

const songNotes = (() => {
    let count = 0;
    let length = 0;
    for (const channel of app.playData.channels) {
        count += channel.notes.length;
        for (const note of channel.notes) length = Math.max(length, note.stopTime);
    }
    return { count, length };
})();
if (ENGINE === 'worklet') {
    app.prepareSF2Worklet();
    for (let i = 0; i < 200 && !isSF2WorkletReady(context); i++) await new Promise((r) => setTimeout(r, 50));
    if (!isSF2WorkletReady(context)) throw new Error('worklet engine did not become ready');
}

const origCreateNote = app.createNote.bind(app);
const origCreatePerc = app.createPercussionNote.bind(app);
app.createNote = (option) => { stat.noteOns++; return origCreateNote(option); };
app.createPercussionNote = (option) => { stat.noteOns++; return origCreatePerc(option); };

const mb = (n) => (n / 1048576).toFixed(1);
const heapMb = () => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : NaN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

say(`${songNotes.count} notes, ${songNotes.length.toFixed(1)}s per pass | engine ${ENGINE} | ${SECS}s soak`);
if (!performance.memory) say('WARNING: no performance.memory, pass CHROME_FLAGS=--enable-precise-memory-info');
say('');
say('    t | note-ons | heap MB | live nodes | peak | gains | sources | buf MB alloc | stopFuncs | noteOn | noteOff');

function sample(t) {
    const s = {
        t,
        noteOns: stat.noteOns,
        heapMb: heapMb(),
        live: stat.live, peakLive: stat.peakLive,
        liveByKind: { ...stat.liveByKind },
        bufferBytes: stat.bufferBytes,
        buffers: stat.buffers,
        stopFuncs: (app.states.stopFuncs || []).length,
        noteOnAry: (app.states.noteOnAry || []).length,
        noteOffAry: (app.states.noteOffAry || []).length,
    };
    results.samples.push(s);
    say(`${String(t.toFixed(0)).padStart(5)} | ${String(s.noteOns).padStart(8)} | ${s.heapMb.toFixed(1).padStart(7)} | `
        + `${String(s.live).padStart(10)} | ${String(s.peakLive).padStart(4)} | ${String(s.liveByKind.gain || 0).padStart(5)} | `
        + `${String(s.liveByKind.source || 0).padStart(7)} | ${mb(s.bufferBytes).padStart(10)} | `
        + `${String(s.stopFuncs).padStart(9)} | ${String(s.noteOnAry).padStart(6)} | ${String(s.noteOffAry).padStart(7)}`);
}

app.play(true);
const t0 = performance.now();
sample(0);
while (performance.now() - t0 < SECS * 1000) {
    await sleep(SAMPLE_MS);
    sample((performance.now() - t0) / 1000);
}

app.stop();
const stopped = { ...stat, liveByKind: { ...stat.liveByKind }, stopFuncs: (app.states.stopFuncs || []).length };
say(`\nstopped at ${(stat.noteOns)} note-ons; draining ${DRAIN}s…`);
await sleep(DRAIN * 1000);
const final = {
    t: (performance.now() - t0) / 1000,
    noteOns: stat.noteOns,
    heapMb: heapMb(),
    live: stat.live, peakLive: stat.peakLive,
    liveByKind: { ...stat.liveByKind },
    bufferBytes: stat.bufferBytes,
    buffers: stat.buffers,
    stopFuncs: (app.states.stopFuncs || []).length,
    noteOnAry: (app.states.noteOnAry || []).length,
    noteOffAry: (app.states.noteOffAry || []).length,
};
results.samples.push(final);
results.final = final;
results.bufferSizes = stat.bufferSizes;
results.stopped = stopped;

say(`${String(final.t.toFixed(0)).padStart(5)} | ${String(final.noteOns).padStart(8)} | ${final.heapMb.toFixed(1).padStart(7)} | `
    + `${String(final.live).padStart(10)} | ${String(final.peakLive).padStart(4)} | ${String(final.liveByKind.gain || 0).padStart(5)} | `
    + `${String(final.liveByKind.source || 0).padStart(7)} | ${mb(final.bufferBytes).padStart(10)} | `
    + `${String(final.stopFuncs).padStart(9)} | ${String(final.noteOnAry).padStart(6)} | ${String(final.noteOffAry).padStart(7)}`);

// The question is the slope, not the absolute: a per note leak shows up as a
// straight line through the samples, a bounded cache flattens out.
const first = results.samples[0];
const last = results.samples[results.samples.length - 2] || first;
const dNotes = last.noteOns - first.noteOns;
if (dNotes > 0) {
    const perK = ((last.heapMb - first.heapMb) * 1024) / (dNotes / 1000);
    say(`\nheap slope: ${(last.heapMb - first.heapMb).toFixed(1)} MB over ${dNotes} notes `
        + `= ${perK.toFixed(1)} KB/note (extrapolates to ${((perK * 100) / 1024).toFixed(2)} GB at 100k notes)`);
}
say(`live nodes by kind at end: ${Object.entries(final.liveByKind).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
say(`nodes created ${stat.createdTotal}, disconnected ${stat.disconnected}, still live ${stat.live}`);
say(`AudioBuffers created ${stat.buffers}, ${mb(stat.bufferBytes)} MB allocated in total`);
const sizes = Object.entries(stat.bufferSizes).sort((a, b) => b[1] - a[1]).slice(0, 8);
say(`chunk lengths allocated (frames x count): ${sizes.map(([len, n]) => `${len} x ${n}`).join(', ')}`);

await context.close().catch(() => {});
window.__BENCH__ = results;
document.title = 'BENCH-DONE';
