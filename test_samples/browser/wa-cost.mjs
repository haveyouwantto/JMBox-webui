/**
 * What does the audio thread actually pay for?
 *
 * The Web Audio SF2 engine moves the whole per-voice DSP into native nodes, so
 * its realtime cost is the node graph, not JavaScript. An OfflineAudioContext
 * renders that graph single threaded with no deadline, so its wall time is a
 * usable stand-in for "how much of a core the audio thread needs".
 *
 * This page renders the same 10 seconds of audio at a fixed voice count with
 * one node type added at a time, so the marginal cost of each node kind is
 * visible, and then measures the real renderSF2NoteWebAudio graph for a dense
 * note set.
 *
 * Usage: node scripts/browser-bench.mjs <font.sf2> <song.mid> --page=wa-cost
 */
import { loadSF2 } from '/lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { renderSF2NoteWebAudio } from '/lib/PicoAudio/src/player/sound-source/sf2-webaudio-renderer.js';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; console.log(s); };
const RATE = 44100;
const SECONDS = Number(params.get('secs') || 10);
const VOICES = Number(params.get('voices') || 200);
const results = {
    ua: navigator.userAgent, seconds: SECONDS, voices: VOICES, cases: [],
    // the harness prints its own table when `info` is absent - give it one
    info: { seconds: SECONDS, voices: VOICES },
};

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();

// One decoded sample, reused by every synthetic case.
const sample = (() => {
    const ctx = new OfflineAudioContext(1, 1, RATE);
    const buffer = ctx.createBuffer(1, Math.round(0.5 * RATE), RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin(i * 0.05) * 0.5;
    buffer._offlineCtx = ctx;
    return buffer;
})();

let shaperCurve = null;
function getCurve() {
    if (!shaperCurve) {
        shaperCurve = new Float32Array(1025);
        for (let i = 0; i < shaperCurve.length; i++) shaperCurve[i] = Math.pow(10, (((i / 1024) * 2) - 1) * 0.6 / 20);
    }
    return shaperCurve;
}

/**
 * `build(ctx)` returns nothing; every case starts from the same N looping
 * sources so the difference is exactly the extra nodes.
 */
async function measure(label, build) {
    const ctx = new OfflineAudioContext(2, Math.round(SECONDS * RATE), RATE);
    const t0 = performance.now();
    build(ctx);
    const built = performance.now() - t0;
    const t1 = performance.now();
    await ctx.startRendering();
    const rendered = performance.now() - t1;
    const rt = SECONDS * 1000 / (rendered + built);
    results.cases.push({ label, builtMs: built, renderMs: rendered, realtimeRatio: rt, corePercent: 100 / rt });
    say(`${label.padEnd(34)} build ${built.toFixed(0).padStart(4)}ms  render ${rendered.toFixed(0).padStart(5)}ms  `
        + `${rt.toFixed(1)}x realtime (${(100 / rt).toFixed(1)}% of a core)`);
    return { built, rendered };
}

/** N looping mono sources at `rate`, straight to the destination. */
function sources(ctx, n, rate, gain) {
    for (let i = 0; i < n; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample;
        src.loop = true;
        src.loopEnd = 0.5;
        src.playbackRate.value = rate;
        if (gain) {
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, 0);
            g.gain.linearRampToValueAtTime(0.2, 0.05);
            g.gain.exponentialRampToValueAtTime(0.001, 0.4);
            src.connect(g);
            g.connect(ctx.destination);
        } else {
            src.connect(ctx.destination);
        }
        src.start(0);
        src.stop(SECONDS);
    }
}

say(`N = ${VOICES} voices, ${SECONDS}s of audio, ${RATE} Hz\n`);

await measure(`${VOICES} BufferSources (rate 1)`, (ctx) => sources(ctx, VOICES, 1));
await measure(`${VOICES} BufferSources (rate 1.03)`, (ctx) => sources(ctx, VOICES, 1.03));
await measure(`${VOICES} BufferSources + gain env`, (ctx) => sources(ctx, VOICES, 1, true));
await measure(`${VOICES} BufferSources + biquad lowpass`, (ctx) => {
    for (let i = 0; i < VOICES; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 4000; f.Q.value = 0;
        src.connect(f); f.connect(ctx.destination);
        src.start(0); src.stop(SECONDS);
    }
});
await measure(`${VOICES} oscillator LFO + gain`, (ctx) => {
    for (let i = 0; i < VOICES; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = 6;
        const g = ctx.createGain(); g.gain.value = 12;
        osc.connect(g); g.connect(src.detune);
        src.connect(ctx.destination);
        src.start(0); src.stop(SECONDS);
        osc.start(0); osc.stop(SECONDS);
    }
});
await measure(`${VOICES} LFO -> waveshaper -> gain.gain`, (ctx) => {
    for (let i = 0; i < VOICES; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
        const osc = ctx.createOscillator();
        osc.type = 'triangle'; osc.frequency.value = 6;
        const shaper = ctx.createWaveShaper();
        shaper.curve = getCurve();
        const g = ctx.createGain(); g.gain.value = 0;
        osc.connect(shaper); shaper.connect(g.gain); g.connect(src.detune);
        src.connect(ctx.destination);
        src.start(0); src.stop(SECONDS);
        osc.start(0); osc.stop(SECONDS);
    }
});
await measure(`${VOICES} stereo pairs + merger`, (ctx) => {
    for (let i = 0; i < VOICES; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
        const l = ctx.createGain(), r = ctx.createGain();
        l.gain.value = 0.7; r.gain.value = 0.7;
        const merge = ctx.createChannelMerger(2);
        src.connect(l); src.connect(r);
        l.connect(merge, 0, 0); r.connect(merge, 0, 1);
        merge.connect(ctx.destination);
        src.start(0); src.stop(SECONDS);
    }
});
await measure(`${VOICES} stereo panner`, (ctx) => {
    for (let i = 0; i < VOICES; i++) {
        const src = ctx.createBufferSource();
        src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
        const g = ctx.createGain(); g.gain.value = 0.7;
        const p = ctx.createStereoPanner(); p.pan.value = 0.2;
        src.connect(g); g.connect(p); p.connect(ctx.destination);
        src.start(0); src.stop(SECONDS);
    }
});
await measure(`convolver 3.5s IR (app reverb)`, (ctx) => {
    const ir = ctx.createBuffer(2, Math.round(3.5 * RATE), RATE);
    for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    }
    const conv = ctx.createConvolver(); conv.buffer = ir;
    const src = ctx.createBufferSource(); src.buffer = sample; src.loop = true; src.loopEnd = 0.5;
    src.connect(conv); conv.connect(ctx.destination);
    src.start(0); src.stop(SECONDS);
});

/* --------------------------------------------- the real engine's graph -- */

function makeHost(ctx) {
    const master = ctx.createGain();
    master.connect(ctx.destination);
    return {
        context: ctx, states: { startTime: 0 }, baseLatency: 0, masterGainNode: master,
        settings: { generateVolume: 0.15, sf2Engine: 'webaudio' },
        channels: new Array(17).fill(null).map(() => [0, 0, 1]),
    };
}

const midiU8 = new Uint8Array(await (await fetch('/__song.mid')).arrayBuffer());
const { default: PicoAudio } = await import('/lib/PicoAudio/src/main.js');
const boot = new PicoAudio({});
const parsed = boot.parseSMF(midiU8);
if (boot.context) await boot.context.close().catch(() => {});

// a dense window: take every note that sounds inside the first N seconds
const WINDOW = SECONDS;
const noteList = [];
for (let ch = 0; ch < 16; ch++) {
    for (const note of parsed.channels[ch].notes) {
        if (note.startTime < WINDOW && note.stopTime > 0) noteList.push({ note, ch });
    }
}

async function measureEngine(label) {
    const ctx = new OfflineAudioContext(2, Math.round(WINDOW * RATE), RATE);
    loadSF2(ctx, fontAb);
    const host = makeHost(ctx);
    let nodes = 0;
    for (const name of ['createGain', 'createBufferSource', 'createBiquadFilter', 'createOscillator',
        'createWaveShaper', 'createChannelMerger']) {
        const orig = ctx[name].bind(ctx);
        ctx[name] = (...a) => { nodes++; return orig(...a); };
    }
    const t0 = performance.now();
    for (const { note, ch } of noteList) {
        renderSF2NoteWebAudio.call(host, {
            startTime: Math.max(0, note.startTime), stopTime: Math.min(WINDOW, note.stopTime),
            instrument: note.instrument, pitch: note.pitch, velocity: note.velocity,
            channel: ch, isDrum: ch === 9, midiVelocity: Math.round(note.velocity * 127),
            midiVolume: 127, midiExpression: 127,
        });
    }
    const built = performance.now() - t0;
    const t1 = performance.now();
    await ctx.startRendering();
    const rendered = performance.now() - t1;
    const rt = WINDOW * 1000 / (rendered + built);
    results.cases.push({ label, notes: noteList.length, nodes, builtMs: built, renderMs: rendered, realtimeRatio: rt });
    say(`${label.padEnd(34)} ${String(noteList.length).padStart(5)} notes ${String(nodes).padStart(6)} nodes  `
        + `build ${built.toFixed(0).padStart(4)}ms  render ${rendered.toFixed(0).padStart(5)}ms  ${rt.toFixed(1)}x realtime (${(100 / rt).toFixed(1)}% core)`);
}

say('');
await measureEngine('engine: real note graph');

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
