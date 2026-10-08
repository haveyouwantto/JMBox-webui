/**
 * Micro benchmarks for the questions the engine's design depends on:
 *
 *  1. How much does a non-unity playbackRate (interpolation) really cost
 *     compared with the rate == 1 fast path?
 *  2. Does a node graph cost audio thread time *before* its source starts?
 *     (i.e. does the player's 100..1100 ms lookahead buy worse audio thread
 *     load in webaudio mode, where nothing has to be pre-rendered?)
 *  3. Is the cost of an LFO oscillator the oscillator itself or the fact that
 *     it is connected to an AudioParam?
 *
 * Usage: node scripts/browser-bench.mjs <font> <song> --page=wa-micro
 */
const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; console.log(s); };
const RATE = 44100;
const SECONDS = 10;
const N = 100;
const results = { ua: navigator.userAgent, cases: [], info: { n: N, seconds: SECONDS } };

const proto = new OfflineAudioContext(1, 1, RATE);
const sample = proto.createBuffer(1, Math.round(0.5 * RATE), RATE);
{
    const d = sample.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05) * 0.5;
}
// Same waveform, but recorded at half the context rate: playing it makes Chrome
// resample the buffer (which is what ~57% of GeneralUser's samples need).
const sampleHalf = (() => {
    const b = proto.createBuffer(1, Math.round(0.25 * RATE), RATE / 2);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.05) * 0.5;
    return b;
})();

async function measure(label, build) {
    const ctx = new OfflineAudioContext(2, Math.round(SECONDS * RATE), RATE);
    const t0 = performance.now();
    build(ctx);
    const built = performance.now() - t0;
    const t1 = performance.now();
    await ctx.startRendering();
    const rendered = performance.now() - t1;
    const core = (100 * (built + rendered)) / (SECONDS * 1000);
    results.cases.push({ label, builtMs: built, renderMs: rendered, percentOfCore: core });
    say(`${label.padEnd(44)} build ${built.toFixed(0).padStart(4)}ms  render ${rendered.toFixed(0).padStart(5)}ms  ${core.toFixed(2)}% of a core`);
}

/** N looping sources at `rate`, optionally with the engine's envelope shape. */
function voices(ctx, { rate = 1, gain = false, filter = false, startAt = 0, stopAt = SECONDS, buffer = sample } = {}) {
    for (let i = 0; i < N; i++) {
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.loopEnd = buffer.duration;
        src.playbackRate.value = rate;
        let tail = src;
        if (filter) {
            const f = ctx.createBiquadFilter();
            f.type = 'lowpass'; f.frequency.value = 4000;
            tail.connect(f); tail = f;
        }
        if (gain) {
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, 0);
            g.gain.linearRampToValueAtTime(0.5, 0.02);
            g.gain.exponentialRampToValueAtTime(0.05, 1.5);
            tail.connect(g); tail = g;
        }
        tail.connect(ctx.destination);
        src.start(startAt);
        src.stop(stopAt);
    }
}

say(`N = ${N} voices, ${SECONDS}s render\n`);

await measure('rate 1.0', (ctx) => voices(ctx, { rate: 1 }));
await measure('rate 1.0001', (ctx) => voices(ctx, { rate: 1.0001 }));
await measure('rate 1.01', (ctx) => voices(ctx, { rate: 1.01 }));
await measure('rate 1.03', (ctx) => voices(ctx, { rate: 1.03 }));
await measure('rate 1.5', (ctx) => voices(ctx, { rate: 1.5 }));
await measure('rate 2.0', (ctx) => voices(ctx, { rate: 2 }));
await measure('rate 1.0, buffer @ half context rate', (ctx) => voices(ctx, { rate: 1, buffer: sampleHalf }));
await measure('rate 1.03, buffer @ half context rate', (ctx) => voices(ctx, { rate: 1.03, buffer: sampleHalf }));
say('');
await measure('rate 1 + envelope gain', (ctx) => voices(ctx, { rate: 1, gain: true }));
await measure('rate 1.03 + envelope gain', (ctx) => voices(ctx, { rate: 1.03, gain: true }));
await measure('rate 1.03 + gain + filter', (ctx) => voices(ctx, { rate: 1.03, gain: true, filter: true }));
say('');
await measure('rate 1.03, sources start at t=0', (ctx) => voices(ctx, { rate: 1.03, startAt: 0, stopAt: 5 }));
await measure('rate 1.03, sources start at t=5s', (ctx) => voices(ctx, { rate: 1.03, startAt: 5, stopAt: SECONDS }));
say('');
await measure('100 osc (not connected)', (ctx) => {
    for (let i = 0; i < N; i++) {
        const osc = ctx.createOscillator();
        osc.frequency.value = 6;
        osc.start(0); osc.stop(SECONDS);
    }
});
await measure('100 osc -> gain -> destination', (ctx) => {
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(ctx.destination);
    for (let i = 0; i < N; i++) {
        const osc = ctx.createOscillator();
        osc.frequency.value = 6;
        osc.connect(g);
        osc.start(0); osc.stop(SECONDS);
    }
});
await measure('100 osc -> gain -> param (LFO use)', (ctx) => {
    const target = ctx.createGain();
    const src = ctx.createBufferSource(); src.buffer = sample; src.loop = true;
    src.connect(target); target.connect(ctx.destination);
    src.start(0); src.stop(SECONDS);
    for (let i = 0; i < N; i++) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain(); g.gain.value = 5;
        osc.connect(g); g.connect(target.gain);
        osc.start(0); osc.stop(SECONDS);
    }
});

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
