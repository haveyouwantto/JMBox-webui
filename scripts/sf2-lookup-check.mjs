/**
 * Which notes a SoundFont cannot play at all?
 *
 * Every engine (dsp, webaudio, worklet) resolves a note to a preset through
 * getSF2PresetIndex() and then to regions through noteOnVoices(); when either
 * comes back empty the note is silently skipped - it looks like "missing notes"
 * no matter which engine is selected.
 *
 * This walks the GM programs (bank 0, plus the banks the font actually has) and
 * the percussion keys, and reports anything that resolves to no sound.
 *
 * Usage: node scripts/sf2-lookup-check.mjs <font.sf2> [more.sf2 ...]
 */
import fs from 'fs';
import { loadSF2, getSF2Font, getSF2PresetIndex } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { noteOnVoices } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';

const RATE = 44100;
const files = process.argv.slice(2);
if (files.length === 0) {
    console.error('usage: node scripts/sf2-lookup-check.mjs <font.sf2> ...');
    process.exit(2);
}

const sounds = (presetIndex, key, velocity, isDrum) => presetIndex >= 0
    && noteOnVoices(getSF2Font(), presetIndex, key, velocity / 127).length > 0;

for (const file of files) {
    const buf = fs.readFileSync(file);
    loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const font = getSF2Font();
    const banks = [...new Set(font.presets.filter(Boolean).map((p) => p.bank))].sort((a, b) => a - b);

    // melodic: every GM program at the banks the font carries
    const silentPrograms = [];
    for (const bank of banks.filter((b) => b < 120)) {
        for (let program = 0; program < 128; program++) {
            const index = getSF2PresetIndex(program, false, bank, 60, 100);
            if (!sounds(index, 60, 100, false)) silentPrograms.push(`${bank}/${program}`);
        }
    }

    // percussion: every key a GM kit can use, with and without a bank select
    const silentDrums = [];
    for (const bank of [0, 120, 127, 128]) {
        for (let key = 27; key <= 87; key++) {
            const index = getSF2PresetIndex(0, true, bank, key, 100);
            if (!sounds(index, key, 100, true)) silentDrums.push(`${bank}:${key}`);
        }
    }

    console.log(`\n${file}`);
    console.log(`  banks ${banks.join(',')} | ${font.presets.filter(Boolean).length} presets`);
    console.log(`  silent melodic (bank/program): ${silentPrograms.length
        ? `${silentPrograms.length} of ${banks.filter((b) => b < 120).length * 128} -> ${silentPrograms.slice(0, 12).join(' ')}${silentPrograms.length > 12 ? ' ...' : ''}`
        : 'none'}`);
    console.log(`  silent drums (bank:key):       ${silentDrums.length
        ? `${silentDrums.length} of 244 -> ${silentDrums.slice(0, 12).join(' ')}${silentDrums.length > 12 ? ' ...' : ''}`
        : 'none'}`);
}
