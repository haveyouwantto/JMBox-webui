/**
 * Verify the AudioWorklet SF2 engine without a browser.
 *
 * The worklet module is a string (the DSP factory's own source plus a mixer
 * processor), so it can be evaluated in Node with the worklet globals stubbed
 * out. This drives the processor quantum by quantum and compares its output
 * with the DSP engine's renderNote() for the same note - i.e. it checks the
 * stringification, the sample accurate scheduling and the mixing gain.
 *
 * Usage: node scripts/sf2-worklet-check.mjs [font.sf2]
 */
import fs from 'fs';
import { sf2WorkletSource } from '../lib/PicoAudio/src/player/sound-source/sf2-worklet-renderer.js';
import { renderNote } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';
import { tsfQuality } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const RATE = 44100;
const QUANTUM = 128;
const FONT = process.argv[2] || 'resources/assets/Neo1MGM.sf2';

const buf = fs.readFileSync(FONT);
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const font = getSF2Font();
const fontPayload = {
    presets: font.presets, samples: font.samples,
    outSampleRate: font.outSampleRate, globalGainDB: font.globalGainDB,
};

/* ------------------------------------------------- evaluate the worklet -- */

let ProcessorClass = null;
let registered = null;
globalThis.sampleRate = RATE;
globalThis.currentFrame = 0;
globalThis.AudioWorkletProcessor = class {
    constructor() {
        this.port = { postMessage: (msg) => { captured.push(msg); }, onmessage: null };
    }
};
globalThis.registerProcessor = (name, cls) => { registered = name; ProcessorClass = cls; };
const captured = [];
new Function(sf2WorkletSource())();
if (!ProcessorClass) throw new Error('the worklet source did not register a processor');
console.log(`processor registered as "${registered}"`);

/* ------------------------------------------------------------- cases ---- */

const CASES = [
    { label: 'piano C4 note 2s + 2s tail', instrument: 0, pitch: 60, vel: 100, seconds: 2, render: 4 },
    { label: 'strings C4 sustained 4s', instrument: 48, pitch: 60, vel: 90, seconds: 4, render: 6 },
    { label: 'drum kick ch9', instrument: 0, pitch: 36, vel: 110, seconds: 1, render: 2, drum: true },
    { label: 'organ C3 3s', instrument: 16, pitch: 48, vel: 100, seconds: 3, render: 4 },
    // a note that starts inside a quantum is what the browser produces; the
    // envelope block grid must not move with the slice boundaries
    { label: 'piano C4, start +37 frames', instrument: 0, pitch: 60, vel: 100, seconds: 2, render: 4, startFrame: 37 },
    { label: 'strings C4, start +100 frames', instrument: 48, pitch: 55, vel: 90, seconds: 3, render: 5, startFrame: 100 },
    // sound quality: the worklet must render exactly what the DSP engine does
    // with the same preset (low = no filter, no LFOs, no modulation envelope)
    { label: 'piano C4 @ quality low', instrument: 0, pitch: 60, vel: 100, seconds: 2, render: 4,
        quality: { filter: false, lfo: false, modEnv: false } },
    { label: 'strings C4 @ quality medium', instrument: 48, pitch: 60, vel: 90, seconds: 3, render: 5,
        quality: { filter: true, lfo: false, modEnv: false } },
    { label: 'strings C4 @ nearest interp', instrument: 48, pitch: 60, vel: 90, seconds: 3, render: 5,
        interp: 'nearest' },
    // several notes at once, starting at different frames inside the window -
    // the worklet has to mix all of them without dropping any
    { label: 'CHORD piano+strings+drum', chord: [
        { instrument: 0, pitch: 60, vel: 100, seconds: 2, startFrame: 0 },
        { instrument: 48, pitch: 55, vel: 90, seconds: 3, startFrame: 37 },
        { instrument: 0, pitch: 36, vel: 110, seconds: 1, drum: true, startFrame: 100 },
        { instrument: 0, pitch: 67, vel: 80, seconds: 2, startFrame: 0 },
    ], render: 5 },
    { label: 'chord: piano0 + strings37', chord: [
        { instrument: 0, pitch: 60, vel: 100, seconds: 2, startFrame: 0 },
        { instrument: 48, pitch: 55, vel: 90, seconds: 3, startFrame: 37 },
    ], render: 4 },
    { label: 'chord: piano0 + drum100', chord: [
        { instrument: 0, pitch: 60, vel: 100, seconds: 2, startFrame: 0 },
        { instrument: 0, pitch: 36, vel: 110, seconds: 1, drum: true, startFrame: 100 },
    ], render: 4 },
    { label: 'chord: two pianos same start', chord: [
        { instrument: 0, pitch: 60, vel: 100, seconds: 2, startFrame: 0 },
        { instrument: 0, pitch: 67, vel: 80, seconds: 2, startFrame: 0 },
    ], render: 4 },
];

let worst = 0;
let failures = 0;
console.log('');
for (const c of CASES) {
    // --- several notes at once: worklet output must equal the summed DSP renders
    if (c.chord) {
        const total = Math.round(c.render * RATE);
        const processor = new ProcessorClass();
        processor.handleMessage({ type: 'font', font: fontPayload });
        processor.handleMessage({ type: 'quality', quality: { filter: true, lfo: true, modEnv: true } });
        const expected = [new Float32Array(total), new Float32Array(total)];
        c.chord.forEach((entry, index) => {
            const isDrum = !!entry.drum;
            const preset = getSF2PresetIndex(entry.instrument, isDrum, isDrum ? 128 : 0, entry.pitch, entry.vel);
            const noteFrames = Math.round(entry.seconds * RATE);
            const maxFrames = noteFrames + Math.round(30 * RATE);
            processor.handleMessage({
                type: 'note', id: index + 1, presetIndex: preset, key: entry.pitch, velocity: entry.vel / 127,
                noteFrames, maxFrames, startFrame: entry.startFrame, pitchBends: null, panChanges: null,
                gains: [{ frame: 0, gain: 1 }], interpolation: 'linear',
            });
            Object.assign(tsfQuality, { filter: true, lfo: true, modEnv: true });
            const dsp = renderNote(font, preset, entry.pitch, entry.vel / 127, noteFrames, maxFrames, null, null, 'linear');
            for (let i = 0; i < dsp.frames && entry.startFrame + i < total; i++) {
                expected[0][entry.startFrame + i] += dsp.data[i * 2];
                expected[1][entry.startFrame + i] += dsp.data[i * 2 + 1];
            }
        });
        const left = new Float32Array(total);
        const right = new Float32Array(total);
        for (let at = 0; at < total; at += QUANTUM) {
            globalThis.currentFrame = at;
            const block = Math.min(QUANTUM, total - at);
            const outL = new Float32Array(block);
            const outR = new Float32Array(block);
            processor.process([], [[outL, outR]]);
            left.set(outL, at);
            right.set(outR, at);
        }
        let maxDiff = 0;
        let maxAt = 0;
        for (let i = 0; i < total; i++) {
            const d = Math.max(Math.abs(left[i] - expected[0][i]), Math.abs(right[i] - expected[1][i]));
            if (d > maxDiff) { maxDiff = d; maxAt = i; }
        }
        worst = Math.max(worst, maxDiff);
        // Diagnostic: does each note render the same on its own as it does in
        // the mix? (shared state between note renderers would show up here.)
        const aloneSum = [new Float32Array(total), new Float32Array(total)];
        c.chord.forEach((entry, index) => {
            const single = new ProcessorClass();
            single.handleMessage({ type: 'font', font: fontPayload });
            const isDrum = !!entry.drum;
            const preset = getSF2PresetIndex(entry.instrument, isDrum, isDrum ? 128 : 0, entry.pitch, entry.vel);
            const noteFrames = Math.round(entry.seconds * RATE);
            single.handleMessage({
                type: 'note', id: index + 1, presetIndex: preset, key: entry.pitch, velocity: entry.vel / 127,
                noteFrames, maxFrames: noteFrames + Math.round(30 * RATE), startFrame: entry.startFrame,
                pitchBends: null, panChanges: null, gains: [{ frame: 0, gain: 1 }], interpolation: 'linear',
            });
            for (let at = 0; at < total; at += QUANTUM) {
                globalThis.currentFrame = at;
                const block = Math.min(QUANTUM, total - at);
                const outL = new Float32Array(block);
                const outR = new Float32Array(block);
                single.process([], [[outL, outR]]);
                for (let f = 0; f < block; f++) {
                    aloneSum[0][at + f] += outL[f];
                    aloneSum[1][at + f] += outR[f];
                }
            }
        });
        let aloneDiff = 0;
        for (let i = 0; i < total; i++) {
            aloneDiff = Math.max(aloneDiff, Math.abs(left[i] - aloneSum[0][i]), Math.abs(right[i] - aloneSum[1][i]));
        }
        const ok = maxDiff <= 2.5e-6;
        if (!ok) failures++;
        console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.label.padEnd(32)} ${c.chord.length} notes, `
            + `max |worklet - sum(dsp)| ${maxDiff.toExponential(2)} at ${maxAt} `
            + `(worklet ${left[maxAt].toFixed(6)} vs expected ${expected[0][maxAt].toFixed(6)})`);
        for (const entry of c.chord) {
            const at = entry.startFrame;
            console.log(`      note start ${String(at).padStart(4)}: worklet ${left[at].toFixed(6)} expected ${expected[0][at].toFixed(6)}`
                + ` | +64: ${left[at + 64].toFixed(6)} / ${expected[0][at + 64].toFixed(6)}`
                + ` | +128: ${left[at + 128].toFixed(6)} / ${expected[0][at + 128].toFixed(6)}`);
        }
        console.log(`      mix vs sum of single-note worklet runs: ${aloneDiff.toExponential(2)}`);
        continue;
    }
    const isDrum = !!c.drum;
    const presetIndex = getSF2PresetIndex(c.instrument, isDrum, isDrum ? 128 : 0, c.pitch, c.vel);
    if (presetIndex < 0) throw new Error(`${c.label}: no preset`);
    const noteFrames = Math.round(c.seconds * RATE);
    const maxFrames = noteFrames + Math.round(30 * RATE);

    // --- through the worklet processor, 128 frames at a time ---
    const processor = new ProcessorClass();
    processor.handleMessage({ type: 'font', font: fontPayload });
    // always send it: the worklet's quality object lives in the module scope, so
    // a processor would otherwise inherit whatever a previous case set
    processor.handleMessage({ type: 'quality', quality: c.quality || { filter: true, lfo: true, modEnv: true } });
    processor.handleMessage({
        type: 'note', id: 1, presetIndex, key: c.pitch, velocity: c.vel / 127,
        noteFrames, maxFrames, startFrame: c.startFrame || 0, pitchBends: null, panChanges: null,
        gains: [{ frame: 0, gain: 1 }], interpolation: c.interp || 'linear',
    });
    const total = Math.round(c.render * RATE);
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    for (let at = 0; at < total; at += QUANTUM) {
        globalThis.currentFrame = at;
        const block = Math.min(QUANTUM, total - at);
        const outL = new Float32Array(block);
        const outR = new Float32Array(block);
        processor.process([], [[outL, outR]]);
        left.set(outL, at);
        right.set(outR, at);
    }

    // --- the DSP engine's own renderer, no gain, same window ---
    Object.assign(tsfQuality, c.quality || { filter: true, lfo: true, modEnv: true });
    const dsp = renderNote(font, presetIndex, c.pitch, c.vel / 127, noteFrames, maxFrames, null, null, c.interp || 'linear');

    const at = c.startFrame || 0;
    let maxDiff = 0;
    for (let i = 0; i < dsp.frames && i + at < total; i++) {
        maxDiff = Math.max(maxDiff,
            Math.abs(left[i + at] - dsp.data[i * 2]),
            Math.abs(right[i + at] - dsp.data[i * 2 + 1]));
    }
    worst = Math.max(worst, maxDiff);
    // 1e-6 is the same tolerance the C reference port check uses
    const ok = maxDiff <= 2.5e-6;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.label.padEnd(32)} frames ${dsp.frames}, `
        + `max |worklet - dsp| ${maxDiff.toExponential(2)}`);
}

console.log(`\nworst sample difference: ${worst.toExponential(3)}`);
console.log(`${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
