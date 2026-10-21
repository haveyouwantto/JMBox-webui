/**
 * Watch the real application (dev server, full UI) while a dense song plays and
 * print the numbers that decide "why does it stall" instead of guessing.
 *
 * The engine benches say the per-sample loop is cheap: 1.3 us per voice per
 * quantum, 128 voices = 6% of one core. So whatever happens at 150 voices is
 * not synthesis. What can still go wrong is everything around a note-on:
 *
 *   - Web Audio node count. The wavetable engine builds six or more native
 *     nodes per note; if they are not released the audio graph grows forever
 *     and the heap grows with it.
 *   - Pre-read lead (states.updateBufTime). The scheduler is allowed to look up
 *     to 1100 ms ahead, and every note it schedules is a full audio graph born
 *     immediately. A big lead at high density means thousands of live nodes.
 *   - The latency integrator (states.latencyTime) is the engine's own measure
 *     of the audio clock falling behind the wall clock, i.e. real underruns.
 *   - JS heap, before and after a forced collection. If a full GC does not give
 *     the memory back it is retained, not just uncollected.
 *
 * Usage: node scripts/app-watch.mjs [url] [song.mid] [seconds]
 *   PRESET=sf2|dsp|webaudio   boot with that engine configuration saved
 *   MAXPOLY=n                 cap voices once the song is loaded
 *   STALL_AT=s STALL_MS=n     freeze the main thread at second s; the
 *                             scheduler should resume at the same position
 *                             instead of skipping ahead (recoverFromStall)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const URL_ARG = process.argv[2] || 'http://127.0.0.1:8080/?perf=1';
const SONG = path.resolve(process.argv[3] || 'test_samples/stress-2000.mid');
const SECONDS = Number(process.argv[4] || 40);

const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('no Chrome found'); process.exit(1); }

const debugPort = 9600 + Math.floor(Math.random() * 300);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jmbox-watch-'));
const chrome = spawn(CHROME, [
    '--window-position=0,0', '--window-size=1000,1000',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info',
    ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []),
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => {
    try { chrome.kill(); } catch (e) { /* noop */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* noop */ }
};
process.on('SIGINT', () => { cleanup(); process.exit(0); });

/** Counts every native audio node the app builds, and every one it releases. */
const INSTRUMENT = `(() => {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const S = window.__nodeStat = {
        created: 0, released: 0, byType: Object.create(null), liveSources: 0,
    };
    const NAMES = ['createGain', 'createOscillator', 'createBufferSource', 'createStereoPanner',
        'createBiquadFilter', 'createConvolver', 'createDelay', 'createWaveShaper',
        'createDynamicsCompressor', 'createPanner', 'createChannelSplitter',
        'createChannelMerger', 'createIIRFilter', 'createConstantSource'];
    for (const n of NAMES) {
        const orig = Ctor.prototype[n];
        if (typeof orig !== 'function') continue;
        Ctor.prototype[n] = function (...a) {
            const node = orig.apply(this, a);
            S.created++;
            S.byType[n] = (S.byType[n] || 0) + 1;
            // A source node that has not ended yet is one sounding voice. This
            // is what the audio thread is actually paying for, and it is much
            // larger than the player's own voice count during release tails.
            const isSource = n === 'createOscillator' || n === 'createBufferSource' || n === 'createConstantSource';
            if (isSource) {
                S.liveSources++;
                let ended = false;
                const finish = () => {
                    if (ended) return;
                    ended = true;
                    S.liveSources--;
                };
                // 'ended' fires when the source really stops; stop(t) only
                // schedules that, so it must not decrement here. Listening on
                // the event also survives the engine overwriting .onended.
                try { node.addEventListener('ended', finish); } catch (e) { /* noop */ }
            }
            let done = false;
            const disc = node.disconnect;
            node.disconnect = function (...x) {
                if (!done) { done = true; S.released++; }
                return disc.apply(this, x);
            };
            return node;
        };
    }
    // The note scheduler is a 1 ms setInterval; counting its callbacks shows
    // whether the main thread is being throttled (which starves note-on).
    S.ticks = 0;
    S.ticks1ms = 0;
    let lastTick = performance.now();
    S.tickRate = 0;
    const si = window.setInterval;
    window.setInterval = function (fn, ms, ...rest) {
        if (ms === 1 || ms === 0) {
            S.ticks1ms++;
            return si.call(this, function (...x) {
                S.ticks++;
                const now = performance.now();
                if (now - lastTick >= 1000) { S.tickRate = S.ticks; S.ticks = 0; lastTick = now; }
                return fn.apply(this, x);
            }, ms, ...rest);
        }
        return si.call(this, fn, ms, ...rest);
    };
})();`;

const SAMPLE = `(() => {
    const pa = window.picoAudio, st = pa && pa.states, ctx = pa && pa.context;
    const S = window.__nodeStat || { created: 0, released: 0, byType: {} };
    const mem = performance.memory;
    const quality = pa && pa.settings ? pa.settings.soundQuality : null;
    const out = {
        pos: ctx && st && Number.isFinite(st.startTime) ? +(ctx.currentTime - st.startTime).toFixed(1) : null,
        voices: st && st.stopFuncs ? st.stopFuncs.length : -1,
        onAry: st && st.noteOnAry ? st.noteOnAry.length : -1,
        offAry: st && st.noteOffAry ? st.noteOffAry.length : -1,
        bufMs: st ? Math.round(st.updateBufTime || 0) : -1,
        bufMax: st ? Math.round(st.updateBufMaxTime || 0) : -1,
        latMs: st ? Math.round(st.latencyTime || 0) : -1,
        heap: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : -1,
        total: mem ? +(mem.totalJSHeapSize / 1048576).toFixed(1) : -1,
        created: S.created, released: S.released, liveSources: S.liveSources,
        // Notes the scheduler has dispatched so far, and how far it has moved
        // the play index: the difference between two samples is the note-on
        // rate, which is what a stall followed by a catch-up burst looks like.
        disp: st && st.playIndices ? st.playIndices.reduce((a, b) => a + b, 0) : -1,
        byType: S.byType,
        quality,
        workletReady: pa && pa.isSF2WorkletReady ? pa.isSF2WorkletReady() : null,
        sf2Engine: pa && pa.settings ? pa.settings.sf2Engine : null,
        state: ctx ? ctx.state : '?',
        ctxNow: ctx ? +ctx.currentTime.toFixed(2) : -1,
        startT: st && Number.isFinite(st.startTime) ? +st.startTime.toFixed(2) : -1,
        dur: pa && pa.getDuration ? +pa.getDuration().toFixed(1) : -1,
        limit: st ? Math.round(st.latencyLimitTime || 0) : -1,
        ticks: S.ticks != null ? S.ticks1ms : -1,
        tickRate: S.tickRate || 0,
        drain: ctx ? +(ctx.outputLatency || 0).toFixed(3) : -1,
    };
    return out;
})()`;

function fmtRow(t, a, prev) {
    const dc = a.created - (prev ? prev.created : a.created);
    const dr = a.released - (prev ? prev.released : a.released);
    const dh = prev ? (a.heap - prev.heap) : 0;
    return [
        String(t).padStart(4),
        `pos ${String(a.pos ?? '-').padStart(5)}`,
        `ctx ${String(a.ctxNow).padStart(6)}`,
        `voice ${String(a.voices).padStart(5)}`,
        `src ${String(a.liveSources).padStart(5)}`,
        `on ${String(a.onAry).padStart(4)}`,
        `off ${String(a.offAry).padStart(4)}`,
        `lead ${String(a.bufMs).padStart(4)}/${String(a.bufMax).padStart(4)}`,
        `lat ${String(a.latMs).padStart(4)}`,
        `lim ${String(a.limit).padStart(5)}`,
        `tick ${String(a.tickRate).padStart(4)}`,
        `nodes ${String(a.created - a.released).padStart(6)}`,
        `+${String(dc).padStart(5)}/-${String(dr).padStart(5)}`,
        `note+${String(prev && a.disp >= 0 && prev.disp >= 0 ? a.disp - prev.disp : 0).padStart(5)}`,
        `heap ${String(a.heap).padStart(6)} (${dh >= 0 ? '+' : ''}${dh.toFixed(1)})`,
        // Only a problem when the worklet was asked for and did not come up.
        a.sf2Engine === 'worklet' && a.workletReady === false ? 'BK:no-worklet' : '',
    ].join('  ');
}

try {
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
            if (r.ok) {
                const created = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
                target = await created.json();
            }
        } catch (e) { /* not up */ }
        if (!target) await sleep(250);
    }
    if (!target) throw new Error(`chrome not up${chromeErr ? `\n${chromeErr.slice(-800)}` : ''}`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        // Page-side warnings are how the engine reports a silent fallback
        // ("SF2 AudioWorklet unavailable, using the DSP engine"), which changes
        // what is being measured more than any setting does.
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'log'
            && msg.params.type !== 'debug') {
            const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
            if (text) console.log(`  [page ${msg.params.type}] ${text.slice(0, 1600)}`);
        }
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        }
    };
    const evaluate = async (expression) => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
        return r.result.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');
    await send('HeapProfiler.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTRUMENT });
    await send('Page.navigate', { url: URL_ARG });
    await send('Page.bringToFront');

    let ready = false;
    for (let i = 0; i < 120; i++) {
        try { ready = await evaluate('!!(window.picoAudio && document.querySelector("#uploader"))'); } catch (e) { /* loading */ }
        if (ready) break;
        await sleep(1000);
    }
    if (!ready) throw new Error('app never came up');

    // Reproduce a saved setup the way the user has it, before the player is
    // created: settings come from localStorage at boot, and the SF2 worklet
    // module is only prepared once init sees sf2Engine === 'worklet'. Switching
    // after the fact leaves the worklet cold, and the first notes fall back to
    // the DSP engine, which synthesizes on the main thread - a completely
    // different machine than the one we mean to measure.
    // soundQuality 4 selects the soundfont; sf2Engine picks how it is rendered
    // (worklet = on the audio thread, dsp/webaudio = on the main thread).
    const preset = process.env.PRESET;
    if (['sf2', 'dsp', 'webaudio'].includes(preset)) {
        const engine = preset === 'sf2' ? 'worklet' : preset;
        const keys = await evaluate(`(() => {
            const set = (k, v) => localStorage.setItem('jmbox.' + k, v);
            set('configVersion', '2');
            set('soundQuality', '4');
            set('sf2Engine', '${engine}');
            set('sf2Quality', 'high');
            set('currentSF2Name', 'Neo1MGM.sf2');
            return Object.keys(localStorage).filter((k) => k.startsWith('jmbox.')).length;
        })()`);
        await send('Page.navigate', { url: URL_ARG });
        await send('Page.bringToFront');
        let again = false;
        for (let i = 0; i < 120; i++) {
            try { again = await evaluate('!!(window.picoAudio && document.querySelector("#uploader"))'); } catch (e) { /* loading */ }
            if (again) break;
            await sleep(1000);
        }
        if (!again) throw new Error('app did not come back after preset');
        console.log(`preset applied (${keys} keys), reloaded`);
        // The font download and parse plus the worklet module are async.
        for (let i = 0; i < 30; i++) {
            const st = await evaluate(`(() => {
                const pa = window.picoAudio;
                return { sf2: pa.isSF2Loaded ? pa.isSF2Loaded() : null,
                         worklet: pa.isSF2WorkletReady ? pa.isSF2WorkletReady() : null };
            })()`).catch(() => ({}));
            if (st && st.sf2 && st.worklet) { console.log(`font+worklet ready (${i}s)`); break; }
            await sleep(1000);
        }
    }

    const doc = await send('DOM.getDocument', { depth: -1 });
    const node = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#uploader' });
    await send('DOM.setFileInputFiles', { files: [SONG], nodeId: node.nodeId });
    await sleep(3000);

    // Voice cap, to separate "many voices" from "many note-ons per second".
    if (process.env.MAXPOLY) {
        const cap = await evaluate(`(() => {
            const pa = window.picoAudio;
            pa.settings.maxPoly = ${Number(process.env.MAXPOLY)};
            pa.stop();
            pa.play();
            return pa.settings.maxPoly;
        })()`).catch((e) => `error ${e.message}`);
        console.log(`maxPoly -> ${cap}`);
        await sleep(1500);
    }

    const status = await evaluate(`(() => {
        const pa = window.picoAudio, st = pa && pa.states, s = (pa && pa.settings) || {};
        return { playing: !!(st && st.isPlaying),
                 notes: pa && pa.playData ? pa.playData.channels.reduce((a, c) => a + c.notes.length, 0) : -1,
                 loadMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
                 engine: s.sf2Engine, quality: s.sf2Quality, soundQuality: s.soundQuality,
                 sf2: pa.isSF2Loaded ? pa.isSF2Loaded() : null,
                 worklet: pa.isSF2WorkletReady ? pa.isSF2WorkletReady() : null,
                 interp: s.sf2Interpolation, maxPoly: s.maxPoly,
                 sr: pa && pa.context ? pa.context.sampleRate : 0,
                 byType: (window.__nodeStat || {}).byType };
    })()`);
    console.log(`${path.basename(SONG)}: ${JSON.stringify(status)}\n`);

    let prev = await evaluate(SAMPLE).catch(() => null);
    console.log(fmtRow(0, prev, null));

    const samples = [];
    for (let t = 1; t <= SECONDS; t++) {
        await sleep(1000);
        let a;
        try { a = await evaluate(SAMPLE); } catch (e) { continue; }
        samples.push(a);
        console.log(fmtRow(t, a, prev));

        // Halfway through, ask for a full collection. The heap reading before
        // and after tells garbage apart from retention.
        if (t === Math.floor(SECONDS / 2)) {
            await send('HeapProfiler.collectGarbage');
            await sleep(600);
            const g = await evaluate(SAMPLE);
            console.log(`      --- full GC at ${t}s: heap ${prev.heap} -> ${g.heap} MB,`
                + ` live nodes ${g.created - g.released} ---`);
            prev = g;
            samples.push(g);
            continue;
        }
        if (process.env.STALL_AT && t === Number(process.env.STALL_AT)) {
            // Freeze the main thread the way a long task or a backgrounded tab
            // does, and see what the scheduler does when it comes back: the
            // audio clock kept running while nothing was produced.
            const ms = Number(process.env.STALL_MS || 1500);
            const before = await evaluate('window.picoAudio.context.currentTime');
            await evaluate(`(() => { const t0 = performance.now();`
                + ` while (performance.now() - t0 < ${ms}); return 1; })()`);
            const afterStall = await evaluate(`(() => {
                const pa = window.picoAudio, ctx = pa.context, st = pa.states;
                return { ctx: +ctx.currentTime.toFixed(3),
                         pos: +(ctx.currentTime - st.startTime).toFixed(3),
                         voices: st.stopFuncs.length };
            })()`);
            console.log(`      --- stall ${ms} ms: ctx ${before.toFixed(3)} -> ${afterStall.ctx},`
                + ` pos ${afterStall.pos}, voices ${afterStall.voices} ---`);
        }
        prev = a;
    }

    const last = samples[samples.length - 1];
    await send('HeapProfiler.collectGarbage');
    await sleep(600);
    const after = await evaluate(SAMPLE);

    console.log('\n--- summary ---');
    console.log(`heap after final GC: ${after.heap} MB (was ${last.heap} MB during play,`
        + ` ${status.loadMB} MB right after load)`);
    console.log(`live audio nodes at end: ${after.created - after.released}`
        + ` (built ${after.created}, released ${after.released})`);
    const by = Object.entries(after.byType || {}).sort((x, y) => y[1] - x[1]);
    console.log(`by type: ${by.map(([k, v]) => `${k.replace('create', '')} ${v}`).join('  ')}`);
    const peakV = Math.max(...samples.map((s) => s.voices));
    const peakN = Math.max(...samples.map((s) => s.created - s.released));
    const peakLat = Math.max(...samples.map((s) => s.latMs));
    console.log(`peak voices ${peakV} | peak live nodes ${peakN} | peak latency ${peakLat} ms`
        + ` | ctx ${after.state}`);
    const panel = await evaluate(`(() => {
        const el = document.getElementById('perf-monitor');
        return el ? el.innerText : '(no panel)';
    })()`).catch(() => '(unreadable)');
    console.log(`\nperf panel at end:\n${panel}`);
} catch (e) {
    console.error(`failed: ${e.message}`);
    process.exitCode = 1;
} finally {
    cleanup();
}
