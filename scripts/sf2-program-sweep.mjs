/**
 * Sweep every GM program (and the drum kits) through both SF2 engines and
 * report where the Web Audio node graph still disagrees with the TinySoundFont
 * DSP port.
 *
 * The per note A/B (scripts/sf2-engine-ab.mjs) only covers a handful of hand
 * picked instruments, which is how the long `hold` envelope bug and the LFO
 * rate bug survived: the simple fonts used for the first round never hit those
 * code paths. Complex fonts (GeneralUser GS and friends) have hundreds of
 * presets, thousands of regions and every generator a SoundFont can carry, so
 * this walks the whole bank instead of a sample of it.
 *
 * For each case the DSP port is the reference:
 *   - level diff  : RMS difference in dB (a gain / envelope / missing voice bug)
 *   - envelope    : median + p90 of the 100ms RMS envelope difference in dB
 *   - correlation : 1.0 means the two envelopes have the same shape
 *   - wf match    : best lag correlation of the waveform itself (pitch, phase)
 *
 * Requires node-web-audio-api (OfflineAudioContext in Node):
 *   npm i node-web-audio-api        # or point WA_MODULE at its index.mjs
 *
 * Usage: node scripts/sf2-program-sweep.mjs <font.sf2> [--drums] [--all-kits]
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const waModule = process.env.WA_MODULE
    || path.join(process.env.TEMP || '/tmp', 'wa-test', 'node_modules', 'node-web-audio-api', 'index.js');
let OfflineAudioContext;
try {
    ({ OfflineAudioContext } = await import(pathToFileURL(waModule).href));
} catch (e) {
    console.error(`cannot load node-web-audio-api from ${waModule}`);
    console.error('install it with:  npm i node-web-audio-api');
    process.exit(1);
}

const { loadSF2, getSF2Font, getSF2PresetIndex } = await import(
    '../lib/PicoAudio/src/player/sound-source/sf2-provider.js');
const { renderSF2NoteWebAudio } = await import(
    '../lib/PicoAudio/src/player/sound-source/sf2-webaudio-renderer.js');

const args = process.argv.slice(2);
const fontPath = args.find((a) => !a.startsWith('--')) || 'resources/assets/Neo1MGM.sf2';
const withDrums = args.includes('--drums') || args.includes('--all-kits');
const allKits = args.includes('--all-kits');
const RATE = 44100;
const TRIM = Math.pow(10, -12 / 20);
/** Note length: long enough to cover attack/hold/decay of most presets. */
const SECS = Number(process.env.SWEEP_SECS || 1.5);
const KEYS = (process.env.SWEEP_KEYS || '45,60,72').split(',').map(Number);
const VELS = (process.env.SWEEP_VELS || '100').split(',').map(Number);
/** Only report cases whose envelope correlation drops below this. */
const BAD_CORR = Number(process.env.SWEEP_BAD_CORR || 0.98);
const BAD_LEVEL = Number(process.env.SWEEP_BAD_LEVEL || 0.5);

const fontBuf = fs.readFileSync(fontPath);
const fontAb = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);

const ctxFont = new OfflineAudioContext(2, RATE, RATE);
loadSF2(ctxFont, fontAb);
const font = getSF2Font();
if (!font) { console.error('font failed to load'); process.exit(1); }

/** Minimal PicoAudio-alike for the graph renderer. */
function makeHost(ctx) {
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return {
        context: ctx,
        states: { startTime: 0 },
        baseLatency: 0,
        masterGainNode: master,
        settings: { generateVolume: 0.15, sf2Engine: 'webaudio' },
        channels: new Array(17).fill(null).map(() => [0, 0, 1]),
    };
}

const frames = Math.round(SECS * RATE);
const dspL = new Float32Array(frames);          // DSP reference, deinterleaved
const dspR = new Float32Array(frames);
const dspInter = new Float32Array(frames * 2);  // DSP reference, interleaved

/** 100ms RMS envelope in dB (mono sum). */
function envelope(left, right, n, winMs = 100) {
    const win = Math.round((winMs / 1000) * RATE);
    const out = [];
    for (let s = 0; s + win <= n; s += win) {
        let sum = 0;
        for (let i = s; i < s + win; i++) {
            const m = (left[i] + right[i]) * 0.5;
            sum += m * m;
        }
        out.push(20 * Math.log10(Math.max(Math.sqrt(sum / win), 1e-9)));
    }
    return out;
}

const rms = (l, r, n) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const m = (l[i] + r[i]) * 0.5; s += m * m; }
    return Math.sqrt(s / n);
};

/** Waveform match: best correlation over +/-10ms (resampler shift tolerance). */
function waveMatch(a, b, n) {
    let best = -1;
    for (let lag = -Math.round(0.01 * RATE); lag <= Math.round(0.01 * RATE); lag += 4) {
        let num = 0, den1 = 0, den2 = 0;
        for (let i = 0; i < n; i += 5) {
            const j = i + lag;
            if (j < 0 || j >= n) continue;
            const v1 = a[i * 2] + a[i * 2 + 1];
            const v2 = b[j * 2] + b[j * 2 + 1];
            num += v1 * v2; den1 += v1 * v1; den2 += v2 * v2;
        }
        const c = num / Math.sqrt(Math.max(den1 * den2, 1e-20));
        if (c > best) best = c;
    }
    return best;
}

const cases = [];
const programs = process.env.SWEEP_PROGS
    ? process.env.SWEEP_PROGS.split(',').map(Number)
    : Array.from({ length: 128 }, (_, i) => i);
for (const program of programs) {
    for (const key of KEYS) for (const vel of VELS) cases.push({ program, key, vel });
}
if (withDrums) {
    const kits = allKits
        ? new Set(font.presets.filter((p) => p.bank === 128).map((p) => p.preset))
        : new Set([0]);
    for (const kit of kits) {
        for (let key = 35; key <= 81; key++) cases.push({ program: kit, key, vel: 100, drum: true });
    }
}

console.log(`font: ${fontPath}`);
console.log(`${font.presets.length} presets, ${font.presets.reduce((n, p) => n + p.regions.length, 0)} regions, `
    + `${cases.length} cases (${KEYS.length} keys x ${VELS.length} velocities${withDrums ? ' + drums' : ''})`);

const results = [];
let t0 = performance.now();
for (const c of cases) {
    const isDrum = !!c.drum;
    const presetIndex = getSF2PresetIndex(c.program, isDrum, isDrum ? 128 : 0, c.key, c.vel);
    const label = isDrum
        ? `kit ${c.program} key ${c.key}`
        : `prog ${String(c.program).padStart(3)} key ${c.key} vel ${c.vel}`;
    if (presetIndex < 0) { results.push({ label, program: c.program, key: c.key, missing: true }); continue; }

    const dsp = font.renderNote(presetIndex, c.key, c.vel / 127, frames, frames, null, null, 'linear');
    for (let i = 0; i < frames; i++) {
        dspL[i] = dspInter[i * 2] = (dsp.data[i * 2] || 0) * TRIM;
        dspR[i] = dspInter[i * 2 + 1] = (dsp.data[i * 2 + 1] || 0) * TRIM;
    }

    const ctx = new OfflineAudioContext(2, frames, RATE);
    // the font is already loaded above: the graph renderer reads the same
    // global font, and re-parsing it per case only added minutes of setup time
    const host = makeHost(ctx);
    const stopFn = renderSF2NoteWebAudio.call(host, {
        startTime: 0, stopTime: SECS, instrument: c.program, pitch: c.key,
        velocity: c.vel / 127, channel: isDrum ? 9 : 0, isDrum,
        midiVelocity: c.vel, midiVolume: 127, midiExpression: 127,
    });
    const rendered = await ctx.startRendering();
    const gl = rendered.getChannelData(0);
    const gr = rendered.getChannelData(1);

    const envDsp = envelope(dspL, dspR, frames);
    const envGraph = envelope(gl, gr, frames);
    const diffs = envDsp.map((v, i) => v - envGraph[i]).sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)];
    const p90 = diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * 0.9))];
    const rmsDsp = rms(dspL, dspR, frames);
    const rmsGraph = rms(gl, gr, frames);
    const levelDsp = 20 * Math.log10(Math.max(rmsDsp, 1e-9));
    const levelGraph = 20 * Math.log10(Math.max(rmsGraph, 1e-9));
    let corrN = 0, corrA = 0, corrB = 0;
    const mD = envDsp.reduce((a, b) => a + b, 0) / envDsp.length;
    const mG = envGraph.reduce((a, b) => a + b, 0) / envGraph.length;
    for (let i = 0; i < envDsp.length; i++) {
        corrN += (envDsp[i] - mD) * (envGraph[i] - mG);
        corrA += (envDsp[i] - mD) ** 2;
        corrB += (envGraph[i] - mG) ** 2;
    }
    const corr = corrA > 0 && corrB > 0 ? corrN / Math.sqrt(corrA * corrB) : 1;

    // silence on one side only is the loudest possible mismatch
    const silent = (x) => x < 1e-6;
    const graphInter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { graphInter[i * 2] = gl[i]; graphInter[i * 2 + 1] = gr[i]; }
    const wf = (silent(rmsDsp) && silent(rmsGraph)) ? 1 : waveMatch(dspInter, graphInter, frames);
    if (process.env.SWEEP_DEBUG) {
        let peakDsp = 0, peakGraph = 0;
        for (let i = 0; i < frames; i++) {
            peakDsp = Math.max(peakDsp, Math.abs(dspL[i]));
            peakGraph = Math.max(peakGraph, Math.abs(gl[i]));
        }
        console.log(`  [dbg] ${label}: rmsDsp ${levelDsp.toFixed(2)} rmsGraph ${levelGraph.toFixed(2)} `
            + `corr ${corr.toFixed(3)} wf ${wf.toFixed(3)} peak ${peakDsp.toFixed(4)}/${peakGraph.toFixed(4)}`);
    }

    results.push({
        label, program: c.program, key: c.key, drum: isDrum,
        levelDiff: levelGraph - levelDsp, med, p90, corr, wf, noStop: !stopFn,
        preset: font.presets[presetIndex] ? font.presets[presetIndex].name : '?',
    });
}
const elapsed = (performance.now() - t0) / 1000;

const bad = results.filter((r) => !r.missing
    && (Math.abs(r.levelDiff) > BAD_LEVEL || r.corr < BAD_CORR || r.wf < 0.9 || r.noStop));
// worst first: envelope shape, then level
bad.sort((a, b) => (a.corr - b.corr) || (Math.abs(b.levelDiff) - Math.abs(a.levelDiff)));

console.log(`\n${results.length} cases in ${elapsed.toFixed(0)}s, ${bad.length} outside tolerance `
    + `(level >${BAD_LEVEL}dB, corr <${BAD_CORR}, wf <0.9)`);
if (bad.length) {
    console.log('\ncase                            | preset                       | level dB | med/p90 dB | corr   | wf');
    for (const r of bad) {
        console.log(`${r.label.padEnd(31)} | ${String(r.preset).slice(0, 28).padEnd(28)} | `
            + `${r.levelDiff.toFixed(2).padStart(8)} | ${r.med.toFixed(2).padStart(5)}/${r.p90.toFixed(2).padStart(6)} | `
            + `${r.corr.toFixed(3).padStart(6)} | ${r.wf.toFixed(3).padStart(5)}${r.noStop ? ' NO-STOP' : ''}`);
    }
}

const ok = results.filter((r) => !r.missing && !bad.includes(r));
if (ok.length) {
    const worstLevel = ok.reduce((a, b) => (Math.abs(b.levelDiff) > Math.abs(a.levelDiff) ? b : a));
    const worstCorr = ok.reduce((a, b) => (b.corr < a.corr ? b : a));
    console.log(`\nworst of the ${ok.length} passing cases: `
        + `level ${worstLevel.levelDiff.toFixed(2)}dB (${worstLevel.label}), `
        + `corr ${worstCorr.corr.toFixed(4)} (${worstCorr.label})`);
}
const missing = results.filter((r) => r.missing);
if (missing.length) console.log(`\n${missing.length} cases had no preset (program/key out of range)`);

if (process.env.SWEEP_DUMP) {
    fs.mkdirSync(path.join('test_samples', 'sweep'), { recursive: true });
    const file = path.join('test_samples', 'sweep', path.basename(fontPath).replace(/\W+/g, '_') + '.csv');
    fs.writeFileSync(file, 'case,preset,levelDiff,median,p90,corr,wf\n'
        + results.map((r) => r.missing ? `${r.label},MISSING,,,,,`
            : `${r.label},"${r.preset}",${r.levelDiff.toFixed(4)},${r.med.toFixed(4)},${r.p90.toFixed(4)},`
                + `${r.corr.toFixed(6)},${r.wf.toFixed(6)}`).join('\n') + '\n');
    console.log(`\nfull results written to ${file}`);
}
