/**
 * Cost of the AudioWorklet SF2 engine's *audio thread* work, in a real browser.
 *
 * The main thread number (note-on time) says nothing about the worklet engine:
 * its synthesis happens inside process(), and AudioWorkletGlobalScope has no
 * `performance.now()` in Chrome (verified: `typeof performance === 'undefined'`,
 * only `Date.now()` with 1 ms resolution). A single quantum is 2.7 ms, so timing
 * one call is hopeless.
 *
 * So this page amplifies: it hosts a processor built from the engine's own
 * synth source, and each `run` message pulls N quanta per voice in one go and
 * times the batch with Date.now(). That measures throughput of the exact code
 * the engine runs, which is what a slow machine runs out of.
 *
 * Usage: BENCH_HEADED=1 node scripts/browser-bench.mjs <font.sf2> <song.mid> \
 *          --page=wk-load
 */
import { createTsfSynth } from '/lib/PicoAudio/src/player/sf2/tsf-synth.js';
import {
    TSF_LOOPMODE_SUSTAIN, tsfTimecents2Secs, tsfCents2Hertz, tsfDecibelsToGain, tsfGainToDecibels,
} from '/lib/PicoAudio/src/player/sf2/tsf-font.js';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '/lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; };
const results = { ua: navigator.userAgent, info: { engine: 'worklet-load' }, cases: [] };

const QUANTUM = 128;
const PULLS = 4000;
const WARMUP_PULLS = 60;

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
const bootstrap = new AudioContext();
const RATE = bootstrap.sampleRate;
await bootstrap.close();
loadSF2({ sampleRate: RATE }, fontAb.slice(0));
const font = getSF2Font();

// The processor: the engine's synthesizer plus a batch measurement hook.
const source = `
const TSF_LOOPMODE_SUSTAIN = ${TSF_LOOPMODE_SUSTAIN};
const tsfTimecents2Secs = ${tsfTimecents2Secs.toString()};
const tsfCents2Hertz = ${tsfCents2Hertz.toString()};
const tsfDecibelsToGain = ${tsfDecibelsToGain.toString()};
const tsfGainToDecibels = ${tsfGainToDecibels.toString()};
const quality = { filter: true, lfo: true, modEnv: true };
const tsfSynth = (${createTsfSynth.toString()})({
    TSF_LOOPMODE_SUSTAIN, tsfTimecents2Secs, tsfCents2Hertz,
    tsfDecibelsToGain, tsfGainToDecibels, quality,
});
class Load extends AudioWorkletProcessor {
    constructor() {
        super();
        this.font = null;
        this.scratch = new Float32Array(${QUANTUM} * 2);
        this.mixL = new Float32Array(${QUANTUM});
        this.mixR = new Float32Array(${QUANTUM});
        this.port.onmessage = (e) => this.onMessage(e.data);
    }
    onMessage(msg) {
        if (msg.type === 'font') {
            this.font = msg.font;
            this.port.postMessage({ type: 'font', ok: !!this.font, presets: this.font ? this.font.presets.length : 0 });
            return;
        }
        if (msg.type === 'run') {
            try {
                this.port.postMessage({ type: 'result', id: msg.id, ...this.measure(msg) });
            } catch (e) {
                this.port.postMessage({ type: 'result', id: msg.id, error: String(e && e.stack || e) });
            }
        }
    }
    makeRenderers(notes) {
        const out = [];
        for (const n of notes) {
            out.push(tsfSynth.createNoteRenderer(
                this.font, n.presetIndex, n.key, n.vel, n.noteOffFrames, n.maxFrames, null, null, n.interp || 'linear'));
        }
        return out;
    }
    measure(msg) {
        const renderers = this.makeRenderers(msg.notes);
        const mix = msg.mix === true;
        const N = ${QUANTUM};
        const mixL = this.mixL, mixR = this.mixR, scratch = this.scratch;
        // Mirrors the engine's own mixing loop for the common case (a note with
        // a single gain point): interleaved chunk -> two planar output arrays.
        const pull = () => {
            if (mix) { mixL.fill(0); mixR.fill(0); }
            for (const r of renderers) {
                const got = r.render(N, scratch);
                if (!mix || !got) continue;
                for (let f = 0; f < got; f++) {
                    mixL[f] += scratch[f * 2] * 0.5;
                    mixR[f] += scratch[f * 2 + 1] * 0.5;
                }
            }
        };
        for (let i = 0; i < ${WARMUP_PULLS} * Math.max(1, renderers.length); i++) pull();
        // still alive? a dead renderer costs nothing and would flatter the result
        let alive = 0;
        for (const r of renderers) if (!r.isDone()) alive++;
        const pulls = msg.pulls || ${PULLS};
        // Date.now() is the only clock in this scope and it ticks in 1 ms, so
        // each batch has to be long enough for that to be noise, and the batch
        // is repeated - network/GC/preemption only ever makes a batch slower.
        let best = Infinity;
        const all = [];
        for (let round = 0; round < 3; round++) {
            const t0 = Date.now();
            for (let i = 0; i < pulls; i++) pull();
            const ms = Date.now() - t0;
            all.push(ms);
            if (ms < best) best = ms;
        }
        return { ms: best, rounds: all, pulls, voices: renderers.length, alive, mix, quantum: N };
    }
}
registerProcessor('sf2-load', Load);
`;

const context = new AudioContext({ latencyHint: 'interactive' });
await context.resume();
const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
await context.audioWorklet.addModule(url);
URL.revokeObjectURL(url);
const node = new AudioWorkletNode(context, 'sf2-load', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
});
// A silent gain in front of the destination: the node has to be pulled by the
// graph for process() to run, but nothing should be heard.
const mute = context.createGain();
mute.gain.value = 0;
node.connect(mute).connect(context.destination);

const pending = new Map();
let nextId = 1;
node.port.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'font') { pending.get('font')(msg); pending.delete('font'); return; }
    if (msg.type === 'result') {
        const resolve = pending.get(msg.id);
        if (resolve) { pending.delete(msg.id); resolve(msg); }
    }
};
const waitFor = (id) => new Promise((resolve) => pending.set(id, resolve));

pending.set('font', () => {});
node.port.postMessage({
    type: 'font',
    font: {
        presets: font.presets, samples: font.samples,
        outSampleRate: font.outSampleRate, globalGainDB: font.globalGainDB,
    },
});
await waitFor('font');
say(`font in worklet: ${font.presets.length} presets, rate ${RATE}`);

const BUDGET_MS = (QUANTUM / RATE) * 1000;
const noteFor = (program, key, velocity, durSeconds = 60, isDrum = false) => ({
    presetIndex: getSF2PresetIndex(program, isDrum, isDrum ? 128 : 0, key, velocity),
    key,
    vel: velocity / 127,
    noteOffFrames: Math.round(durSeconds * RATE),
    maxFrames: Math.round((durSeconds + 2) * RATE),
});
const repeat = (note, n) => Array.from({ length: n }, () => ({ ...note }));

const CASES = [
    { label: 'idle (0 voices)', notes: [] },
    { label: 'strings  x1', notes: repeat(noteFor(48, 60, 100), 1) },
    { label: 'strings  x8', notes: repeat(noteFor(48, 60, 100), 8) },
    { label: 'strings x16', notes: repeat(noteFor(48, 60, 100), 16) },
    // a decaying instrument gets cheaper as it decays, so keep its batch short
    { label: 'piano    x8', notes: [60, 62, 64, 65, 67, 69, 71, 72].map((k) => noteFor(0, k, 100)), pulls: 400 },
    { label: 'strings x8 cubic', notes: repeat({ ...noteFor(48, 60, 100), interp: 'cubic' }, 8) },
];

say(`quantum ${QUANTUM} frames = ${BUDGET_MS.toFixed(3)} ms at ${RATE} Hz`);
say('');
say('case              | mode        |  voices | us per quantum |  share of one quantum | per voice');
for (const c of CASES) {
    for (const mix of [false, true]) {
        const id = nextId++;
        const reply = waitFor(id);
        node.port.postMessage({ type: 'run', id, notes: c.notes, pulls: c.pulls || PULLS, mix });
        const r = await reply;
        if (r.error) { say(`${c.label}: ${r.error}`); continue; }
        const perQuantum = r.ms / r.pulls;
        const share = perQuantum / BUDGET_MS;
        const perVoice = perQuantum / Math.max(1, r.alive);
        results.cases.push({
            label: c.label, mix, voices: r.voices, alive: r.alive, ms: r.ms, rounds: r.rounds, pulls: r.pulls,
            perQuantum, share, perVoice, quantumMs: BUDGET_MS,
        });
        say(`${c.label.padEnd(17)} | ${(mix ? 'synth+mix' : 'synth').padEnd(11)} | ${String(r.alive).padStart(7)} | `
            + `${(perQuantum * 1000).toFixed(1).padStart(14)} | ${((share * 100).toFixed(1) + '%').padStart(21)} | `
            + `${(perVoice * 1000).toFixed(2).padStart(7)} us  [${r.rounds.join('/')} ms]`);
    }
}
say('');
say('"share of one quantum" is the fraction of the audio thread budget this many voices need;');
say('over 100% on the target device is where it starts glitching.');

await context.close().catch(() => {});
window.__BENCH__ = results;
document.title = 'BENCH-DONE';
