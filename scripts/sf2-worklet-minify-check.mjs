/**
 * The worklet module is built from Function.prototype.toString() of the DSP
 * factory, so the string has to survive the production build's minifier.
 *
 * This minifies tsf-synth.js with terser (same mangle defaults as webpack) and
 * checks that evaluating the factory from the minified source still produces
 * the exact same samples as the unminified one.
 *
 * Usage: node scripts/sf2-worklet-minify-check.mjs [font.sf2]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { minify } from 'terser';
import { createTsfSynth, renderNote, tsfSynth } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';
import {
    TSF_LOOPMODE_SUSTAIN, tsfTimecents2Secs, tsfCents2Hertz,
    tsfDecibelsToGain, tsfGainToDecibels,
} from '../lib/PicoAudio/src/player/sf2/tsf-font.js';
import { loadSF2, getSF2Font } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const RATE = 44100;
const FONT = process.argv[2] || 'resources/assets/Neo1MGM.sf2';
const source = fs.readFileSync('lib/PicoAudio/src/player/sf2/tsf-synth.js', 'utf8');

// webpack's terser defaults: compress + mangle (property mangling is off)
const minified = await minify(source, { module: true });
if (minified.error) throw minified.error;

// The worklet embeds the factory's own source; do the same with the minified
// module - that is exactly what the worklet source builder does at runtime.
const tmp = path.join(os.tmpdir(), `tsf-synth-min-${process.pid}.mjs`);
const fontUrl = pathToFileURL(path.resolve('lib/PicoAudio/src/player/sf2/tsf-font.js')).href;
fs.writeFileSync(tmp, minified.code.replace(/from\s*['"]\.\/tsf-font\.js['"]/, `from '${fontUrl}'`));
const minifiedModule = await import(pathToFileURL(tmp).href);
fs.rmSync(tmp, { force: true });
const minFactory = minifiedModule.createTsfSynth;
if (typeof minFactory !== 'function') throw new Error('createTsfSynth is not exported by the minified module');

const built = new Function(
    'TSF_LOOPMODE_SUSTAIN', 'tsfTimecents2Secs', 'tsfCents2Hertz', 'tsfDecibelsToGain', 'tsfGainToDecibels',
    `return (${minFactory.toString()})({
        TSF_LOOPMODE_SUSTAIN, tsfTimecents2Secs, tsfCents2Hertz, tsfDecibelsToGain, tsfGainToDecibels });`
)(TSF_LOOPMODE_SUSTAIN, tsfTimecents2Secs, tsfCents2Hertz, tsfDecibelsToGain, tsfGainToDecibels);

const buf = fs.readFileSync(FONT);
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const font = getSF2Font();
const preset = font.getPresetIndex(0, 0);

const reference = renderNote(font, preset, 60, 100 / 127, RATE, RATE * 3, null, null, 'linear');
const fromMinified = built.renderNote(font, preset, 60, 100 / 127, RATE, RATE * 3, null, null, 'linear');

let maxDiff = 0;
for (let i = 0; i < reference.frames * 2; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(reference.data[i] - fromMinified.data[i]));
}
console.log(`minified factory: ${minified.code.length} bytes (was ${source.length})`);
console.log(`frames ${reference.frames}, max |minified - original| ${maxDiff}`);
console.log(maxDiff === 0 ? 'ALL CHECKS PASSED' : 'CHECK FAILED');
process.exit(maxDiff === 0 ? 0 : 1);
