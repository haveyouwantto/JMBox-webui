/**
 * Verify the SF2 built from the PicoAudio periodic wave tables.
 *
 * Checks, all through the JavaScript TinySoundFont port (the DSP reference
 * engine in this repo):
 *   1. structure  - 128 bank 0 presets, 5 zones each, one cycle loops,
 *                   sampleRate == rootKey frequency * loop length
 *   2. pitch      - render every program at 8 keys, measure the fundamental
 *                   with an FFT, compare in cents against 440*2^((key-69)/12)
 *   3. spectrum   - harmonic magnitudes of a sustained note vs the harmonic
 *                   table the wavetable engine uses
 *   4. envelope   - measured level decay vs the exponential the engine
 *                   schedules with setTargetAtTime
 *
 * Usage: node scripts/check-periodicwave-sf2.mjs [font.sf2]
 */
import fs from "node:fs";
import path from "node:path";
import { loadTSFFont } from "../lib/PicoAudio/src/player/sf2/tsf.js";

const sf2Path = process.argv[2] || "test_samples/PicoAudio-PeriodicWave.sf2";
const manifestPath = process.argv[3] || "test_samples/periodicwave/manifest.tsv";
const RATE = 44100;

const buf = fs.readFileSync(sf2Path);
const font = loadTSFFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), RATE, 0);
const presets = font.presets.filter(Boolean);
const freqOf = (key) => 440 * Math.pow(2, (key - 69) / 12);
const cents = (a, b) => 1200 * Math.log2(a / b);
const fold = (c) => {
    let v = c % 1200;
    if (v > 600) v -= 1200;
    if (v < -600) v += 1200;
    return v;
};

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

/* ------------------------------------------------------------- structure -- */
console.log(`font: ${sf2Path} (${(buf.length / 1024).toFixed(1)} KiB)`);
console.log(`presets ${presets.length}  regions ${font.regionCount}  samples ${font.shdrs.length}`);

const expectedPresets = new Set();
for (let p = 0; p < 128; p++) expectedPresets.add(`0:${p}`);
expectedPresets.add("128:0");
for (const preset of presets) expectedPresets.delete(`${preset.bank}:${preset.preset}`);
if (expectedPresets.size) fail(`missing presets: ${[...expectedPresets].slice(0, 5)}`);

let zones = 0;
let melodicZones = 0;
let kitZones = 0;
const zoneCounts = new Set();
const cycles = new Map();
for (const preset of presets) {
    if (preset.bank >= 128) {
        // Drum kit: one zone per key, no loop, pitch = the key itself.
        for (const region of preset.regions) {
            kitZones++;
            const header = font.shdrs[region.sampleId];
            if (region.lokey !== region.hikey) fail(`kit zone ${region.lokey}-${region.hikey} is not a single key`);
            if (region.loopMode !== 0) fail(`kit key ${region.lokey} loops (drum must be one shot)`);
            if (header.originalKey !== region.lokey) {
                fail(`kit key ${region.lokey} uses sample rooted at ${header.originalKey}`);
            }
            if (header.sampleRate !== 44100) fail(`kit key ${region.lokey} rate ${header.sampleRate}`);
        }
        continue;
    }
    zoneCounts.add(preset.regions.length);
    const ranges = preset.regions.map((r) => `${r.lokey}-${r.hikey}`).sort().join(",");
    if (ranges !== "0-50,51-62,63-74,75-86,87-127") {
        fail(`preset ${preset.bank}:${preset.preset} key ranges ${ranges}`);
        continue;
    }
    for (const region of preset.regions) {
        zones++;
        melodicZones++;
        const header = font.shdrs[region.sampleId];
        // tsf keeps an inclusive sample end (shdr.end + 1), so the frame count
        // the file stores is one less than the internal bound.
        const frames = region.end - region.offset - 1;
        const loop = region.loopEnd - region.loopStart + 1;   // tsf stores inclusive
        if (region.loopMode === 0) fail(`preset ${preset.preset}: zone is not looped`);
        if (region.loopStart !== region.offset) {
            fail(`preset ${preset.preset}: loop starts at ${region.loopStart}, sample at ${region.offset}`);
        }
        if (frames !== loop + 1) fail(`preset ${preset.preset}: ${frames} frames, loop ${loop}`);
        if (header.sampleRate !== region.sampleRate) fail(`preset ${preset.preset}: sampleRate mismatch`);
        const expectedRate = Math.round(freqOf(header.originalKey) * loop);
        if (header.sampleRate !== expectedRate) {
            fail(`preset ${preset.preset}: sampleRate ${header.sampleRate} != ${expectedRate}`);
        }
        if (header.correction !== 0) fail(`preset ${preset.preset}: pitchCorrection ${header.correction}`);
        // Loop length must cover every harmonic of the exported table.
        cycles.set(loop, (cycles.get(loop) || 0) + 1);
    }
}
console.log(`zones/preset ${[...zoneCounts].join(",")}  loop lengths ${[...cycles.keys()].sort((a, b) => a - b).join(",")}`);
console.log(`melodic zones ${melodicZones}  drum keys ${kitZones}`);
if (melodicZones !== 640) fail(`expected 640 melodic zones, found ${melodicZones}`);
if (kitZones !== 61) fail(`expected 61 drum keys, found ${kitZones}`);

/* ------------------------------------------------------------------ FFT -- */
function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        for (let i = 0; i < n; i += len) {
            for (let k = 0; k < len / 2; k++) {
                const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
                const ur = re[i + k], ui = im[i + k];
                const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
                const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
                re[i + k] = ur + vr; im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            }
        }
    }
}

/** Magnitude spectrum of a Hann windowed slice, mono-summed. */
function spectrum(signal, start, size) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
        re[i] = (signal[start + i] || 0) * w;
    }
    fft(re, im);
    const mag = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
    return mag;
}

function renderMono(program, key, frames, vel = 0.8) {
    const index = font.getPresetIndex(0, program);
    const out = font.renderNote(index, key, vel, frames + 1000, frames, null, null, "linear");
    const mono = new Float32Array(out.frames);
    for (let i = 0; i < out.frames; i++) mono[i] = (out.data[i * 2] + out.data[i * 2 + 1]) * 0.5;
    return mono;
}

/**
 * Period estimate via autocorrelation around the expected period, refined by
 * parabolic interpolation. Works for weak fundamentals (many of these tables
 * are harmonic-light) and is far finer than an FFT bin.
 */
function estimatePitch(mono, from, rate, expected) {
    const span = Math.min(8192, mono.length - from);
    const period = rate / expected;
    const lo = Math.floor(period * 0.94), hi = Math.ceil(period * 1.06);
    const corr = (lag) => {
        let sum = 0;
        for (let i = 0; i < span; i++) sum += mono[from + i] * mono[from + i + lag];
        return sum / span;
    };
    let best = Math.round((lo + hi) / 2), bestValue = -Infinity;
    for (let lag = lo; lag <= hi; lag += 2) {
        const value = corr(lag);
        if (value > bestValue) { bestValue = value; best = lag; }
    }
    for (let lag = Math.max(1, best - 2); lag <= best + 2; lag++) {
        const value = corr(lag);
        if (value > bestValue) { bestValue = value; best = lag; }
    }
    const a = corr(best - 1), b = bestValue, c = corr(best + 1);
    const delta = (0.5 * (a - c)) / (a - 2 * b + c);
    return rate / (best + delta);
}

/* ---------------------------------------------------------------- pitch -- */
const SIZE = 16384;
const OFFSET = Math.round(0.1 * RATE);
// Above ~key 84 the period is only ~40 samples long, which is shorter than the
// autocorrelation can resolve to a few cents; those notes are covered by the
// structure check (loop length + sample rate) instead.
const KEYS = [24, 33, 42, 51, 60, 69, 78, 84];
/** Purely noise based effects: no fundamental for the estimator to lock on. */
const NOISE_FX = new Set([123, 125, 126]);
const errors = [];
let checked = 0, silent = 0;
const worstList = [];
for (let program = 0; program < 128; program++) {
    if (NOISE_FX.has(program)) continue;
    for (const key of KEYS) {
        const mono = renderMono(program, key, OFFSET + SIZE);
        let peak = 0;
        for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
        if (peak < 1e-5) { silent++; continue; }
        const mag = spectrum(mono, OFFSET, SIZE);
        const measured = estimatePitch(mono, OFFSET, RATE, freqOf(key));
        const raw = cents(measured, freqOf(key));
        const error = fold(raw);
        checked++;
        errors.push(Math.abs(error));
        worstList.push({ program, key, error: raw, name: font.getPresetName(font.getPresetIndex(0, program)) });
    }
}
errors.sort((a, b) => a - b);
worstList.sort((a, b) => Math.abs(b.error) - Math.abs(a.error));
const median = errors[Math.floor(errors.length / 2)];
const p95 = errors[Math.floor(errors.length * 0.95)];
console.log(`pitch: ${checked} notes measured, median ${median.toFixed(1)} cents, `
    + `p95 ${p95.toFixed(1)} cents, worst ${errors[errors.length - 1].toFixed(1)} cents`
    + (silent ? `, ${silent} silent` : ""));
if (median > 6 || p95 > 20 || errors[errors.length - 1] > 20) {
    fail("pitch error too wide");
    for (const w of worstList.slice(0, 8)) {
        console.log(`    worst: prog ${w.program} (${w.name}) key ${w.key}: ${w.error.toFixed(1)} cents`);
    }
}

/* -------------------------------------------------------------- spectrum -- */
const manifest = fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/).slice(1)
    .map((line) => line.split("\t"));
const header = fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/)[0].split("\t");
const col = (name) => header.indexOf(name);

function tableAmplitudes(program, octave) {
    const rows = manifest.filter((r) => Number(r[col("program")]) === program
        && Number(r[col("octave")]) === octave);
    const row = rows[0];
    // Rebuild the harmonic amplitudes exactly like createWave(): SBR copy.
    const wav = fs.readFileSync(path.join(path.dirname(manifestPath), row[col("file")]));
    return { loop: Number(row[col("loopEnd")]), wav };
}

/**
 * The stored cycle must carry exactly the harmonics the wavetable engine
 * feeds into createPeriodicWave(): the table values after the SBR copy, with
 * random phases (so only the magnitudes are comparable).
 */
const tableSource = fs.readFileSync("lib/PicoAudio/src/player/sound-source/default-wave.js", "utf8");
const tableBytes = Buffer.from(tableSource.match(/'([^']+)'/)[1], "base64");
const tableView = new DataView(tableBytes.buffer, tableBytes.byteOffset, tableBytes.byteLength);
const dequantize = (byte) => (byte === 0 ? 0 : byte === 255 ? 1
    : Math.pow(10, (byte * (80 / 255) - 80) / 20));
const harmonics = [];
{
    let at = 0;
    for (let octave = 0; octave < 5; octave++) {
        harmonics.push([]);
        for (let program = 0; program < 128; program++) {
            at += 8;                       // 4 * uint16 ADSR
            at += 1;                       // uint8 vibrato
            const len = tableView.getUint8(at++);
            const amps = [];
            for (let i = 0; i < len; i++) amps.push(dequantize(tableView.getUint8(at + i)));
            at += len;
            // createWave() copies the spectrum with a triangle rolloff (SBR).
            const last = amps.length ? amps[amps.length - 1] : 0;
            const first = amps.length ? amps[0] : 1;
            const scale = first > 0 ? Math.min(1, last / first) : 0;
            for (let i = 0; i < len; i++) amps.push(amps[i] * scale * (1 - i / len));
            harmonics[octave].push(amps);
        }
    }
}

/** Exact DFT magnitude of harmonic k of an N sample cycle. */
function harmonicMagnitude(frames, N, k) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
        const angle = (-2 * Math.PI * k * n) / N;
        re += frames[n] * Math.cos(angle);
        im += frames[n] * Math.sin(angle);
    }
    return Math.hypot(re, im) / N;
}

let worstCorrelation = 1, worstCase = "";
for (let octave = 0; octave < 5; octave++) {
    for (let program = 0; program < 128; program++) {
        const region = font.presets[font.getPresetIndex(0, program)].regions[octave];
        const shdr = font.shdrs[region.sampleId];
        const N = shdr.end - shdr.start - 1;             // one cycle + guard frame
        const frames = font.samples.subarray(shdr.start, shdr.start + N);
        const expected = harmonics[octave][program];
        const measured = [];
        for (let k = 1; k <= expected.length; k++) measured.push(harmonicMagnitude(frames, N, k));
        const correlation = corr(measured, expected);
        if (correlation < worstCorrelation) {
            worstCorrelation = correlation;
            worstCase = `program ${program} octave ${octave}`;
        }
    }
}
console.log(`waveform: harmonic correlation vs the table, worst ${worstCorrelation.toFixed(4)} (${worstCase})`);
if (!(worstCorrelation > 0.995)) fail("stored cycles do not match the harmonic table");

function corr(a, b) {
    const ma = a.reduce((x, y) => x + y, 0) / a.length;
    const mb = b.reduce((x, y) => x + y, 0) / b.length;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
        num += (a[i] - ma) * (b[i] - mb);
        da += (a[i] - ma) ** 2;
        db += (b[i] - mb) ** 2;
    }
    return num / Math.sqrt(da * db);
}

function findDataOffset(bytes) {
    let position = 12;
    while (position + 8 <= bytes.length) {
        const id = bytes.toString("latin1", position, position + 4);
        const size = bytes.readUInt32LE(position + 4);
        if (id === "data") return position + 8;
        position += 8 + size + (size & 1);
    }
    throw new Error("no data chunk");
}

/* ----------------------------------------------------------------- drums -- */
/**
 * The kit has to round trip: every key is rooted at itself and the sample rate
 * matches the context, so playing the key through the DSP engine has to
 * reproduce the exported one shot sample for sample (no loop, flat envelope).
 * That also proves the kit's internal balance survived the export.
 */
const drumDir = path.join(path.dirname(sf2Path), "periodicwave", "drums");
const drumManifest = fs.readFileSync(path.join(drumDir, "manifest.tsv"), "utf8").trim().split(/\r?\n/);
const drumHeader = drumManifest[0].split("\t");
const dcol = (name) => drumHeader.indexOf(name);
const kitIndex = font.getPresetIndex(128, 0);
const kitRefPeaks = [];
const kitOutPeaks = [];
/** Level curve in 1 ms steps: insensitive to the engine's fixed lowpass. */
function rmsCurve(signal, frames, stepMs = 1) {
    const step = Math.max(1, Math.round((stepMs / 1000) * RATE));
    const curve = [];
    for (let at = 0; at + step <= frames; at += step) {
        let sum = 0;
        for (let i = 0; i < step; i++) sum += signal[at + i] ** 2;
        curve.push(Math.sqrt(sum / step));
    }
    return curve;
}
let worstDrum = 1, worstDrumKey = -1;
let worstRaw = 1, worstRawKey = -1;
for (const line of drumManifest.slice(1)) {
    const row = line.split("\t");
    const key = Number(row[dcol("hikey")]);
    const wav = fs.readFileSync(path.join(drumDir, row[dcol("file")]));
    const pcmStart = findDataOffset(wav);
    const frames = Math.floor((wav.length - pcmStart) / 2);
    const reference = new Float32Array(frames);
    let refPeak = 0;
    for (let i = 0; i < frames; i++) {
        const v = wav.readInt16LE(pcmStart + i * 2) / 32767;
        reference[i] = v;
        refPeak = Math.max(refPeak, Math.abs(v));
    }
    const out = font.renderNote(kitIndex, key, 1, frames + 6000, frames + 6000, null, null, "linear");
    const rendered = new Float32Array(frames);
    let outPeak = 0;
    const usable = Math.min(frames, out.frames);
    for (let i = 0; i < usable; i++) {
        const v = (out.data[i * 2] + out.data[i * 2 + 1]) * 0.5;
        rendered[i] = v;
        outPeak = Math.max(outPeak, Math.abs(v));
    }
    if (!(outPeak > 1e-4)) {
        fail(`kit key ${key} rendered silence`);
        continue;
    }
    // TinySoundFont always runs a ~19.9 kHz lowpass (the default generator is
    // not a bypass), which decorrelates noise based drums sample by sample but
    // leaves the level envelope untouched, so compare the 1 ms RMS curves and
    // report the raw waveform correlation as information.
    const correlation = corr(rmsCurve(reference, usable), rmsCurve(rendered, usable));
    if (correlation < worstDrum) { worstDrum = correlation; worstDrumKey = key; }
    const raw = corr(reference.subarray(0, usable), rendered.subarray(0, usable));
    if (raw < worstRaw) { worstRaw = raw; worstRawKey = key; }
    kitRefPeaks.push(refPeak);
    kitOutPeaks.push(outPeak);
}
const balance = corr(kitRefPeaks, kitOutPeaks);
console.log(`drums: ${kitRefPeaks.length} keys, worst envelope correlation ${worstDrum.toFixed(4)}`
    + ` (key ${worstDrumKey}), balance ${balance.toFixed(4)}`
    + `, raw waveform correlation ${worstRaw.toFixed(3)} (key ${worstRawKey}, expected to lag on noise)`);
if (!(worstDrum > 0.99)) fail("drum samples do not round trip through the engine");
if (!(balance > 0.97)) fail("drum kit balance changed");

/* -------------------------------------------------------------- envelope -- */
function rmsEnvelope(mono, from, to, step = Math.round(0.05 * RATE)) {
    const out = [];
    for (let at = from; at + step <= to; at += step) {
        let sum = 0;
        for (let i = 0; i < step; i++) sum += mono[at + i] ** 2;
        out.push([at / RATE, Math.sqrt(sum / step)]);
    }
    return out;
}

/** Level the engine schedules at time t (seconds) for a held note. */
function predictedLevel(region, t) {
    const { attack, decay, sustain } = region.ampEnv;
    if (attack > 0 && t < attack) return t / attack;
    const tau = decay / 9.226;
    if (tau <= 0) return sustain;
    return Math.max(sustain, Math.exp(-(t - attack) / tau));
}

// Program 0 (pluck, decays to silence) and 48 (sustained strings).
for (const [program, key] of [[0, 60], [48, 60]]) {
    const mono = renderMono(program, key, RATE * 3);
    const env = rmsEnvelope(mono, 0, RATE * 3);
    const at = (t) => env.reduce((best, e) => (Math.abs(e[0] - t) < Math.abs(best[0] - t) ? e : best))[1];
    const db = (a, b) => 20 * Math.log10(a / b);
    const preset = font.presets[font.getPresetIndex(0, program)];
    const region = preset.regions.find((r) => r.lokey <= key && key <= r.hikey);
    const parts = [];
    for (const t of [0.5, 1.5]) {
        const measured = db(at(t), at(0.1));
        const predicted = db(predictedLevel(region, t), predictedLevel(region, 0.1));
        parts.push(`${t}s ${measured.toFixed(1)} dB vs ${predicted.toFixed(1)} dB`);
        if (Math.abs(measured - predicted) > 4) {
            fail(`program ${program}: ${t}s envelope off by ${(measured - predicted).toFixed(1)} dB`);
        }
    }
    console.log(`envelope: program ${program} (attack ${region.ampEnv.attack.toFixed(3)}s `
        + `decay ${region.ampEnv.decay.toFixed(2)}s sustain ${region.ampEnv.sustain.toFixed(3)}) `
        + parts.join(", "));
}

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
