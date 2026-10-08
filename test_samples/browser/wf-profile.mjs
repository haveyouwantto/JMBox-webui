/**
 * Cost of the app's own piano roll (src/main/ui/waterfall.js), which is the one
 * piece of JMBox that scales with "how many notes are on screen" and therefore
 * the prime suspect when playback janks exactly at dense sections.
 *
 * Calls the real renderFrame() over the whole song and reports per frame cost,
 * a few settings variants, and the worst spots.
 *
 * Usage: node scripts/browser-bench.mjs <font.sf2> <song.mid> --page=wf-profile
 */
import PicoAudio from '/lib/PicoAudio/src/main.js';
import { MidiFall } from '/src/main/ui/waterfall.js';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; };
const results = { ua: navigator.userAgent, info: {}, variants: [] };

const midiU8 = new Uint8Array(await (await fetch('/__song.mid')).arrayBuffer());
const boot = new PicoAudio({ soundQuality: 0 });
const midiData = boot.parseSMF(midiU8);
const last = midiData.lastEventTime;
results.info = {
    notes: midiData.channels.reduce((n, c) => n + c.notes.length, 0),
    seconds: last,
};
say(`${results.info.notes} notes over ${last.toFixed(1)}s`);

const canvas = document.querySelector('#waterfall canvas');
const RENDER = { W: 1200, H: 700 };
canvas.width = RENDER.W;
canvas.height = RENDER.H;

function stat(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
        n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
        p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1],
    };
}

const VARIANTS = [
    { label: 'default (canvas2d)', settings: {} },
    { label: 'highlightNotes:false', settings: { highlightNotes: false } },
    { label: 'noteTransparency:true', settings: { noteTransparency: true } },
];

for (const variant of VARIANTS) {
    const settings = {
        highlightNotes: true, noteTransparency: false, detailedNotes: false,
        spanDuration: 4, showBarLines: true, backgroundColor: '#000000',
        ...variant.settings,
    };
    const fall = new MidiFall(canvas, settings);
    fall.resize();
    fall.setMidiData(midiData);

    const FRAMES = 240;
    const times = [];
    for (let i = 0; i < FRAMES; i++) times.push((i / FRAMES) * last);
    // warm up before measuring
    for (const t of times) fall.renderFrame(t);

    // force the canvas to actually rasterise, otherwise the GPU process may
    // swallow the work after we stop measuring
    const ctx = canvas.getContext('2d');
    const costs = [];
    const worst = [];
    for (const t of times) {
        const t0 = performance.now();
        fall.renderFrame(t);
        ctx.getImageData(0, 0, 4, 4);
        const ms = performance.now() - t0;
        costs.push(ms);
        worst.push({ t, ms });
    }
    worst.sort((a, b) => b.ms - a.ms);
    const s = stat(costs);
    results.variants.push({ label: variant.label, ...s, worst: worst.slice(0, 5).map((w) => ({ t: +w.t.toFixed(1), ms: +w.ms.toFixed(2) })) });
    say(`${variant.label}: ${s.mean.toFixed(2)}ms mean, ${s.p95.toFixed(2)}ms p95, ${s.max.toFixed(2)}ms max `
        + `(worst at ${worst.slice(0, 5).map((w) => `${w.t.toFixed(0)}s:${w.ms.toFixed(0)}ms`).join(' ')})`);
}

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
