/**
 * Compare the JavaScript TinySoundFont port in lib/PicoAudio against the
 * reference C implementation (tools/tsf-midi-play/tsf-dump.exe).
 *
 * Both render one note at 44100 Hz, 0 dB global gain, stereo interleaved:
 * note-on at frame 0, note-off at noteOffFrames, release rendered out.
 *
 * Run: node scripts/tsf-port-check.mjs [--dump-only]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadTSFFont } from '../lib/PicoAudio/src/player/sf2/tsf.js';

const RATE = 44100;
const EXE = path.resolve('tools/tsf-midi-play/tsf-dump.exe');
const TMP = os.tmpdir();

const CASES = [
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 0, key: 60, vel: 100, noteOff: 1.0, total: 3.0 },
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 0, key: 84, vel: 40, noteOff: 0.5, total: 2.0 },
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 25, key: 45, vel: 110, noteOff: 0.8, total: 3.0 },
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 48, key: 60, vel: 90, noteOff: 0.05, total: 1.0 },
    { font: 'test_samples/RLNDGM.sf2', bank: 128, program: 0, key: 36, vel: 110, noteOff: 0.2, total: 1.5 },
    { font: 'resources/assets/Neo1MGM.sf2', bank: 0, program: 0, key: 69, vel: 100, noteOff: 0.8, total: 3.0 },
    { font: 'resources/assets/Neo1MGM.sf2', bank: 0, program: 48, key: 55, vel: 90, noteOff: 1.0, total: 3.0 },
    { font: 'resources/assets/Neo1MGM.sf2', bank: 0, program: 10, key: 45, vel: 100, noteOff: 1.0, total: 3.0 },
    { font: 'resources/assets/Neo1MGM.sf2', bank: 128, program: 0, key: 42, vel: 100, noteOff: 0.1, total: 1.0 },
    { font: 'test_samples/__Florestan_Basic_GM_GS.sf2', bank: 0, program: 16, key: 60, vel: 100, noteOff: 0.5, total: 2.0 },
    { font: 'test_samples/__Florestan_Basic_GM_GS.sf2', bank: 0, program: 0, key: 48, vel: 127, noteOff: 2.0, total: 4.0 },
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 0, key: 60, vel: 100, noteOff: 1.0, total: 2.5, bend: 4 },
    { font: 'test_samples/RLNDGM.sf2', bank: 0, program: 0, key: 60, vel: 100, noteOff: 1.0, total: 2.5, bend: -2, pan: 0 },
    { font: 'resources/assets/Neo1MGM.sf2', bank: 0, program: 48, key: 60, vel: 100, noteOff: 1.0, total: 2.5, pan: 127 },
];

const fontCache = new Map();
function getFont(file) {
    if (!fontCache.has(file)) {
        const buf = fs.readFileSync(file);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        fontCache.set(file, loadTSFFont(ab, RATE, 0));
    }
    return fontCache.get(file);
}

function compare(c) {
    const font = getFont(c.font);
    const presetIndex = font.getPresetIndex(c.bank, c.program);
    if (presetIndex < 0) return { ...c, error: `no preset bank ${c.bank} program ${c.program}` };

    const vel = c.vel / 127;
    const noteOffFrames = Math.round(c.noteOff * RATE);
    const totalFrames = Math.round(c.total * RATE);
    // TSF's channel pitch wheel is an integer, so mirror its quantisation:
    // pitchShift = wheel / 16383 * pitchRange * 2 - pitchRange (range 2).
    const wheel = c.bend ? Math.trunc(((c.bend + 2) / 4) * 16383) : 8192;
    const pitchBends = c.bend ? [{ frame: 0, value: (wheel / 16383) * 4 - 2 }] : null;
    const panChanges = c.pan != null ? [{ frame: 0, value: (c.pan << 7) / 16383 }] : null;
    const js = font.renderNote(presetIndex, c.key, vel, noteOffFrames, totalFrames, pitchBends, panChanges);

    const rawPath = path.join(TMP, `tsf-port-${path.basename(c.font, '.sf2')}-${c.bank}-${c.program}-${c.key}-${c.vel}.raw`);
    const args = [c.font, String(presetIndex), String(c.key), String(c.vel),
        String(c.noteOff), String(c.total), rawPath];
    if (c.bend != null || c.pan != null) {
        args.push(String(c.bend || 0));
        if (c.pan != null) args.push(String(c.pan));
    }
    execFileSync(EXE, args, { stdio: 'pipe' });

    const raw = fs.readFileSync(rawPath);
    const ref = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));

    const n = Math.min(ref.length, js.data.length);
    let maxDiff = 0, sumDiff = 0, sumRef = 0, worstAt = -1;
    for (let i = 0; i < n; i++) {
        const d = Math.abs(ref[i] - js.data[i]);
        if (d > maxDiff) { maxDiff = d; worstAt = i; }
        sumDiff += d * d;
        sumRef += ref[i] * ref[i];
    }
    // anything the reference renders after the JS voices have died must be silent
    let refTailMax = 0;
    for (let i = js.data.length; i < ref.length; i++) refTailMax = Math.max(refTailMax, Math.abs(ref[i]));

    fs.unlinkSync(rawPath);

    return {
        ...c,
        presetIndex,
        preset: font.getPresetName(presetIndex),
        jsFrames: js.frames,
        refFrames: ref.length / 2,
        maxDiff,
        worstAt,
        rmsDiff: Math.sqrt(sumDiff / n),
        rmsRef: Math.sqrt(sumRef / n),
        refTailMax,
    };
}

let worst = 0;
console.log('font                       bank prog key vel | preset idx  | frames ref/js | maxDiff    rmsDiff    rmsRef');
for (const c of CASES) {
    const r = compare(c);
    if (r.error) { console.log(`${r.font} ${r.bank} ${r.program}: ${r.error}`); continue; }
    console.log(
        `${path.basename(r.font).padEnd(26)} ${String(r.bank).padStart(4)} ${String(r.program).padStart(4)} `
        + `${String(r.key).padStart(3)} ${String(r.vel).padStart(3)} | ${String(r.preset).slice(0, 14).padEnd(14)} `
        + `${String(r.presetIndex).padStart(3)} | ${String(r.refFrames).padStart(6)}/${String(r.jsFrames).padStart(6)} | `
        + `${r.maxDiff.toExponential(2)} ${r.rmsDiff.toExponential(2)} ${r.rmsRef.toExponential(2)}`
        + `${r.refTailMax > 1e-6 ? `  tail! ${r.refTailMax.toExponential(2)}` : ''}`
    );
    worst = Math.max(worst, r.maxDiff);
}
console.log(`\nworst sample difference: ${worst.toExponential(3)}`);
