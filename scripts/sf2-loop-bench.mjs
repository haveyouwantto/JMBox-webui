/**
 * Cost of the SF2 synthesis loop alone, for iterating on the inner sample path.
 *
 * The browser benches (scripts/browser-bench.mjs) measure the whole engine -
 * graph plumbing, buffers, timers, realtime deadlines - which is what the user
 * hears but is too noisy to tell whether a change to the per sample code helped.
 * This one renders the same set of notes with renderNote() over and over and
 * reports how much audio per wall second the pure synthesis achieves.
 *
 * Usage: node scripts/sf2-loop-bench.mjs [font.sf2] [song.mid] [seconds]
 */
import fs from 'fs';
import path from 'path';
import picoAudioConstructor from '../lib/PicoAudio/src/init/constructor.js';
import parseSMF from '../lib/PicoAudio/src/smf/parse-smf.js';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { createNoteRenderer, noteOnVoices, tsfQuality } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';

const RATE = 44100;
const FONT = process.argv[2] || 'resources/assets/Neo1MGM.sf2';
const SONG = process.argv[3] || 'Y:/midi/Generation/Claude Opus 5.5/crimson_vanguard_battle.mid';
const SECONDS = Number(process.argv[4] || 15);
const PASSES = Number(process.env.PASSES || 4);

const buf = fs.readFileSync(FONT);
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const font = getSF2Font();

const self = {};
picoAudioConstructor.call(self, {});
self.settings.soundQuality = 4;
const data = parseSMF.call(self, new Uint8Array(fs.readFileSync(SONG)));
if (typeof data === 'string') throw new Error(data);

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
        notes.push({
            presetIndex, pitch: note.pitch, vel: midiVel / 127, off,
            voices: Math.max(1, noteOnVoices(font, presetIndex, note.pitch, midiVel / 127).length),
        });
    }
}

// The reference caps the release tail at 30 s; a bench does not need that much.
const MAX_TAIL_SECONDS = 8;
/** One 0.25 s streaming chunk, the same shape the player pulls in realtime. */
const CHUNK = 12000;
const scratch = new Float32Array(CHUNK * 2);

/**
 * Render every note the way the player does: pull fixed size chunks into one
 * reused scratch buffer.
 *
 * Not renderNote(): that grows a private buffer per note, so a pass allocates
 * hundreds of megabytes and the timings end up measuring the garbage collector
 * (the same configuration measured twice differed by 2x). This path allocates
 * one renderer per note and nothing else, which is what streaming playback
 * actually does.
 */
function runPass(quality, interp) {
    Object.assign(tsfQuality, quality);
    let frames = 0, voiceFrames = 0;
    const t0 = performance.now();
    for (const n of notes) {
        const max = n.off + Math.round(Math.min(MAX_TAIL_SECONDS, 30) * RATE);
        const renderer = createNoteRenderer(font, n.presetIndex, n.pitch, n.vel, n.off, max, null, null, interp);
        while (!renderer.isDone()) {
            const written = renderer.render(CHUNK, scratch);
            if (!written) break;
            frames += written;
            voiceFrames += written * n.voices;
        }
    }
    return { ms: performance.now() - t0, frames, voiceFrames };
}

// How many voices the font layers under these notes (the loop cost scales with it).
let voices = 0;
for (const n of notes) voices += noteOnVoices(font, n.presetIndex, n.pitch, n.vel).length;

const HIGH = { filter: true, lfo: true, modEnv: true };
let configs = [
    { label: 'high (reference)', quality: HIGH, interp: 'linear' },
    { label: 'high + nearest', quality: HIGH, interp: 'nearest' },
    { label: 'medium', quality: { filter: true, lfo: false, modEnv: false }, interp: 'linear' },
    { label: 'low', quality: { filter: false, lfo: false, modEnv: false }, interp: 'nearest' },
];
// ONLY=nearest measures a single configuration in a fresh process. Rendering
// three interpolation modes in one process makes them compete for the same
// optimised code and the numbers stop being comparable to a real session,
// which only ever uses one mode.
if (process.env.ONLY) {
    const match = configs.filter((c) => c.label.includes(process.env.ONLY));
    if (!match.length) throw new Error(`no config matches ONLY=${process.env.ONLY}`);
    configs = match;
}

console.log(`${notes.length} notes / ${voices} voices over ${SECONDS}s, font ${path.basename(FONT)}`);
// Warm up over *every* configuration, twice: V8 keeps tiering this code up for
// several seconds of rendering, so a pass measured right after start-up runs up
// to 1.7x slower than the same pass measured later - enough to invent or hide a
// 30% "improvement".
for (let w = 0; w < 2; w++) {
    for (const config of configs) runPass(config.quality, config.interp);
}

/**
 * The best of N passes, not the mean: the loop still occasionally pays for a
 * collection, and the minimum is the pass where nothing else got in the way.
 */
function best(quality, interp, passes) {
    let bestRun = null;
    const all = [];
    for (let i = 0; i < passes; i++) {
        for (const config of configs) runPass(config.quality, config.interp);
        Object.assign(tsfQuality, quality);
        const run = runPass(quality, interp);
        all.push(run.ms);
        if (!bestRun || run.ms < bestRun.ms) bestRun = run;
    }
    bestRun.spread = `${Math.min(...all).toFixed(0)}-${Math.max(...all).toFixed(0)}`;
    return bestRun;
}

console.log('\nconfig             |    best |  realtime |  ns per');
console.log('                   |         |    factor |  voice frame');
// REVERSE=1 measures the same configurations in the opposite order, to tell a
// real difference from a position dependent JIT effect.
const measured = process.env.REVERSE ? [...configs].reverse() : configs;
for (const config of measured) {
    const run = best(config.quality, config.interp, PASSES);
    const realtime = (run.frames / RATE) / (run.ms / 1000);
    const nsPerSample = (run.ms * 1e6) / run.voiceFrames;
    console.log(`${config.label.padEnd(18)} | ${run.ms.toFixed(0).padStart(6)}ms | ${realtime.toFixed(2).padStart(9)}x | `
        + `${nsPerSample.toFixed(1).padStart(12)}   (${run.spread})`);
}

// Rough split of the reference configuration: how much of the time the lowpass
// filter alone accounts for (it is the only per sample stage that can be
// switched off without changing the note loop itself).
const withFilter = best(HIGH, 'linear', PASSES);
const noFilter = best({ filter: false, lfo: true, modEnv: true }, 'linear', PASSES);
Object.assign(tsfQuality, HIGH);
console.log(`\nlowpass filter: ${(withFilter.ms - noFilter.ms).toFixed(0)}ms of ${withFilter.ms.toFixed(0)}ms `
    + `(${(((withFilter.ms - noFilter.ms) / withFilter.ms) * 100).toFixed(0)}%)`);
