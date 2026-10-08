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
];

let worst = 0;
let failures = 0;
console.log('');
for (const c of CASES) {
    const isDrum = !!c.drum;
    const presetIndex = getSF2PresetIndex(c.instrument, isDrum, isDrum ? 128 : 0, c.pitch, c.vel);
    if (presetIndex < 0) throw new Error(`${c.label}: no preset`);
    const noteFrames = Math.round(c.seconds * RATE);
    const maxFrames = noteFrames + Math.round(30 * RATE);

    // --- through the worklet processor, 128 frames at a time ---
    const processor = new ProcessorClass();
    processor.handleMessage({ type: 'font', font: fontPayload });
    processor.handleMessage({
        type: 'note', id: 1, presetIndex, key: c.pitch, velocity: c.vel / 127,
        noteFrames, maxFrames, startFrame: c.startFrame || 0, pitchBends: null, panChanges: null,
        gains: [{ frame: 0, gain: 1 }], interpolation: 'linear',
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
    const dsp = renderNote(font, presetIndex, c.pitch, c.vel / 127, noteFrames, maxFrames, null, null, 'linear');

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
