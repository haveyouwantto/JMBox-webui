/**
 * Per stage cost of the SF2 synthesis, measured with the DSP engine's own
 * renderer (the AudioWorklet engine runs the same code, so this is its cost
 * breakdown without the realtime noise).
 *
 * Renders the first N seconds of a song with one optional DSP stage switched
 * off at a time and reports the total time per configuration.
 *
 * Usage: node scripts/sf2-stage-bench.mjs [font.sf2] [song.mid] [seconds]
 */
import fs from 'fs';
import picoAudioConstructor from '../lib/PicoAudio/src/init/constructor.js';
import parseSMF from '../lib/PicoAudio/src/smf/parse-smf.js';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { renderNote, tsfQuality } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';

const RATE = 44100;
const FONT = process.argv[2] || 'D:/Documents/capella-soundfonts/GeneralUser GS 1.471/GeneralUser GS v1.471.sf2';
const SONG = process.argv[3] || 'Y:/midi/Generation/Claude Opus 5.5/crimson_vanguard_battle1.mid';
const SECONDS = Number(process.argv[4] || 15);

const buf = fs.readFileSync(FONT);
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const font = getSF2Font();

const self = {};
picoAudioConstructor.call(self, {});
self.settings.soundQuality = 4;
const data = parseSMF.call(self, new Uint8Array(fs.readFileSync(SONG)));
if (typeof data === 'string') throw new Error(data);

// every note that sounds inside the window, with the first 30 s of its tail
const notes = [];
for (let ch = 0; ch < 16; ch++) {
    for (const note of data.channels[ch].notes) {
        if (note.startTime >= SECONDS) continue;
        const isDrum = ch === 9;
        const midiVel = Math.max(0, Math.min(127, Math.round(
            Number.isFinite(note.midiVelocity) ? note.midiVelocity : note.velocity * 127)));
        if (midiVel === 0) continue;
        const presetIndex = getSF2PresetIndex(note.instrument, isDrum, note.bank || 0, note.pitch, midiVel);
        if (presetIndex < 0) continue;
        const off = Math.max(1, Math.round((note.stopTime - note.startTime) * RATE));
        notes.push({ presetIndex, pitch: note.pitch, vel: midiVel / 127, off, max: off + 20 * RATE });
    }
}

const CONFIGS = [
    { label: 'high (reference)', quality: { filter: true, lfo: true, modEnv: true }, interp: 'linear' },
    { label: 'no lowpass filter', quality: { filter: false, lfo: true, modEnv: true }, interp: 'linear' },
    { label: 'no LFOs', quality: { filter: true, lfo: false, modEnv: true }, interp: 'linear' },
    { label: 'no mod envelope', quality: { filter: true, lfo: true, modEnv: false }, interp: 'linear' },
    { label: 'nearest interpolation', quality: { filter: true, lfo: true, modEnv: true }, interp: 'nearest' },
    { label: 'medium (no LFO/modEnv)', quality: { filter: true, lfo: false, modEnv: false }, interp: 'linear' },
    { label: 'low (no filter either)', quality: { filter: false, lfo: false, modEnv: false }, interp: 'linear' },
    { label: 'low + nearest', quality: { filter: false, lfo: false, modEnv: false }, interp: 'nearest' },
];

/** One pass over every note with the given configuration. */
const runPass = (config) => {
    Object.assign(tsfQuality, config.quality);
    const t0 = performance.now();
    for (const n of notes) {
        const rendered = renderNote(font, n.presetIndex, n.pitch, n.vel, n.off, n.max, null, null, config.interp);
        if (!rendered.frames) throw new Error('empty render');
    }
    return performance.now() - t0;
};

console.log(`${notes.length} notes over ${SECONDS}s`);
// Warm the JIT up first, otherwise the first configuration pays for compiling
// the whole renderer and every later one looks faster than it is.
runPass(CONFIGS[0]);
runPass(CONFIGS[0]);

const totals = new Map(CONFIGS.map((c) => [c.label, []]));
for (const pass of [CONFIGS, [...CONFIGS].reverse()]) {
    for (const config of pass) totals.get(config.label).push(runPass(config));
}

console.log('\nconfig                    |   total | ms/note | vs high');
const mean = (label) => totals.get(label).reduce((a, b) => a + b, 0) / totals.get(label).length;
for (const config of CONFIGS) {
    const ms = mean(config.label);
    const vs = mean('high (reference)');
    console.log(`${config.label.padEnd(25)} | ${ms.toFixed(0).padStart(6)}ms | ${(ms / notes.length).toFixed(2).padStart(7)} | `
        + (config.label === 'high (reference)' ? '   -' : `${((ms / vs - 1) * 100).toFixed(1)}%`));
}
