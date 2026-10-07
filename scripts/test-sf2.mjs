/**
 * SF2 smoke test.
 *
 * Parses a SoundFont, loads it into the TinySoundFont based engine, dumps the
 * regions a few notes resolve to, and renders one note to check the DSP path.
 *
 * Usage: node scripts/test-sf2.mjs [font.sf2]
 */
import fs from 'fs';
import { readHydra } from '../lib/PicoAudio/src/player/sf2/tsf.js';
import { tsfCents2Hertz } from '../lib/PicoAudio/src/player/sf2/tsf-font.js';
import {
    loadSF2, isSF2Loaded, getSF2Font, getSF2PresetIndex, getSF2Regions,
} from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const file = process.argv[2] || 'resources/assets/Neo1MGM.sf2';
const buf = fs.readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
console.log(`font: ${file} (${(buf.length / 1024 / 1024).toFixed(1)} MB)\n`);

// --- 1. Raw chunk/hydra extraction ------------------------------------
const { hydra, samples } = readHydra(ab);
console.log('hydra:', [
    `shdr ${hydra.shdrs.length}`, `inst ${hydra.insts.length}`, `ibag ${hydra.ibags.length}`, `igen ${hydra.igens.length}`,
    `phdr ${hydra.phdrs.length - 1}`, `pbag ${hydra.pbags.length}`, `pgen ${hydra.pgens.length}`,
    `smpl ${samples.length} frames`,
].join(' | '));

// --- 2. Load through the engine ---------------------------------------
console.log('\nloadSF2:', loadSF2({ sampleRate: 44100 }, ab), '| isSF2Loaded:', isSF2Loaded());
const font = getSF2Font();
console.log('presets:', font.presets.length, '| regions:', font.regionCount,
    '| sample frames:', font.samples.length);

// --- 3. Region resolution ---------------------------------------------
function showRegions(label, program, pitch, velocity, isDrum = false) {
    const presetIndex = getSF2PresetIndex(program, isDrum, isDrum ? 128 : 0, pitch, velocity);
    const regions = getSF2Regions(program, pitch, velocity, isDrum, presetIndex >= 0);
    console.log(`\n${label} (program ${program}${isDrum ? ', drums' : ''} @ pitch ${pitch} vel ${velocity}): `
        + `preset ${presetIndex} "${font.getPresetName(presetIndex)}", ${regions.length} region(s)`);
    for (const r of regions.slice(0, 4)) {
        console.log(`  - ${r.sampleName} | root ${r.pitchKeycenter} | sampleRate ${r.sampleRate}`
            + ` | loop ${r.loopMode ? `[${r.loopStart},${r.loopEnd}]` : 'off'}`
            + ` | filter ${Math.round(tsfCents2Hertz(r.initialFilterFc))} Hz`
            + ` | pan ${(r.pan * 1000).toFixed(0)}`
            + ` | atten ${r.attenuation.toFixed(2)}`
            + ` | env a/d/r ${r.resolvedAmpEnv.attack.toFixed(3)}/${r.resolvedAmpEnv.decay.toFixed(3)}/${r.resolvedAmpEnv.release.toFixed(3)}`
            + ` | keyRange ${r.lokey}-${r.hikey} velRange ${r.lovel}-${r.hivel}`);
    }
}
showRegions('Piano', 0, 69, 100);
showRegions('Piano (soft)', 0, 69, 20);
showRegions('Piano (loud)', 0, 69, 127);
showRegions('Percussion', 0, 36, 100, true);

// --- 4. DSP smoke: render a note and check it is not silent -----------
const presetIndex = getSF2PresetIndex(0, false, 0, 69, 100);
const rendered = font.renderNote(presetIndex, 69, 100 / 127, 44100, 88200);
let peak = 0;
for (const v of rendered.data) peak = Math.max(peak, Math.abs(v));
console.log(`\nrendered piano A4: ${rendered.frames} frames (${(rendered.frames / 44100).toFixed(2)}s), peak ${peak.toFixed(4)}`);
if (!(rendered.frames > 0 && peak > 0.001)) throw new Error('rendered note is silent');

console.log('\nAll checks passed.');
