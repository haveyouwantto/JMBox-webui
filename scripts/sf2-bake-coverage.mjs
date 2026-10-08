/**
 * How much of a song can use the baked (pre-interpolated) sample path?
 *
 * The Web Audio engine can only play a sample with playbackRate 1 when the
 * pitch is already in the buffer, so voices that modulate pitch or use a
 * sustain loop have to stay on the interpolated path. This reports the reasons
 * and the cache size that baking would need.
 *
 * Usage: node scripts/sf2-bake-coverage.mjs [font.sf2] [song.mid]
 */
import fs from 'fs';
import picoAudioConstructor from '../lib/PicoAudio/src/init/constructor.js';
import parseSMF from '../lib/PicoAudio/src/smf/parse-smf.js';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { noteOnVoices } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';

const FONT = process.argv[2] || 'D:/Documents/capella-soundfonts/GeneralUser GS 1.471/GeneralUser GS v1.471.sf2';
const SONG = process.argv[3] || 'Y:/midi/Generation/Claude Opus 5.5/crimson_vanguard_battle1.mid';
const RATE = 44100;

const buf = fs.readFileSync(FONT);
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const font = getSF2Font();

const self = {};
picoAudioConstructor.call(self, {});
self.settings.soundQuality = 4;
const data = parseSMF.call(self, new Uint8Array(fs.readFileSync(SONG)));
if (typeof data === 'string') throw new Error(data);

const reasons = { total: 0, bakeable: 0, pitchBends: 0, modLfoToPitch: 0, modEnvToPitch: 0, vibLfoToPitch: 0, sustainLoop: 0, tooLong: 0 };
const keys = new Map();      // key -> max frames needed
const rateHistogram = new Map();
const BAKE_MAX_FRAMES = 8 * RATE;

for (let ch = 0; ch < 16; ch++) {
    for (const note of data.channels[ch].notes) {
        const isDrum = ch === 9;
        const midiVel = Math.max(0, Math.min(127, Math.round(
            Number.isFinite(note.midiVelocity) ? note.midiVelocity : note.velocity * 127)));
        if (midiVel === 0) continue;
        const presetIndex = getSF2PresetIndex(note.instrument, isDrum, note.bank || 0, note.pitch, midiVel);
        if (presetIndex < 0) continue;
        const voices = noteOnVoices(font, presetIndex, note.pitch, midiVel / 127);
        // a constant pitch bend needs no automation
        const bends = note.pitchBend || [];
        const bendBase = bends.length ? bends[0].value : 0;
        const movesPitch = bends.some((b) => Math.abs(b.value - bendBase) > 1e-6);
        const noteSeconds = Math.max(0.05, (note.stopTime || note.startTime) - note.startTime);
        for (const voice of voices) {
            const region = voice.region;
            reasons.total++;
            let why = null;
            if (movesPitch) why = 'pitchBends';
            else if (region.modLfoToPitch) why = 'modLfoToPitch';
            else if (region.modEnvToPitch) why = 'modEnvToPitch';
            else if (region.vibLfoToPitch) why = 'vibLfoToPitch';
            else if (region.loopMode === 2) why = 'sustainLoop';
            const release = voice.ampenv.parameters.release || 0.01;
            const need = Math.ceil((noteSeconds + Math.max(0.01, release) + 0.2) * RATE);
            if (!why && need > BAKE_MAX_FRAMES) why = 'tooLong';
            if (why) reasons[why]++;
            else reasons.bakeable++;

            const rate = Math.pow(2, voice.pitchInputTimecents / 1200) * voice.pitchOutputFactor;
            rateHistogram.set(Math.round(rate * 1e3), (rateHistogram.get(Math.round(rate * 1e3)) || 0) + 1);
            if (!why) {
                const key = `${region.sampleId}@${Math.round(rate * 1e6)}`;
                keys.set(key, Math.max(keys.get(key) || 0, Math.min(need, BAKE_MAX_FRAMES)));
            }
        }
    }
}

let bytes = 0;
for (const frames of keys.values()) bytes += frames * 4;
console.log(`${FONT.split(/[\\/]/).pop()} + ${SONG.split(/[\\/]/).pop()}`);
console.log(`voices: ${reasons.total}`);
for (const [k, v] of Object.entries(reasons)) {
    if (k === 'total' || k === 'bakeable') continue;
    if (v) console.log(`  fallback ${k.padEnd(14)} ${v}`);
}
console.log(`  bakeable        ${reasons.bakeable} (${(100 * reasons.bakeable / reasons.total).toFixed(1)}%)`);
console.log(`distinct baked streams: ${keys.size}, total ${(bytes / 1048576).toFixed(1)} MiB`);
const uniqueRates = [...rateHistogram.keys()].sort((a, b) => b - rateHistogram.get(a) - 0 || a - b);
console.log(`distinct rates: ${uniqueRates.length}`);
