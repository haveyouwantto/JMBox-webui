/**
 * A/B the SF2 synthesis engines: JavaScript DSP (TinySoundFont port) vs the
 * Web Audio node graph.
 *
 * Both use the same regions, envelopes, pan law and gains, so this measures
 * what moving the DSP into native nodes actually changes and what it saves:
 *   - per note: 100ms RMS envelope difference, overall level, peak, and the
 *     JavaScript time spent scheduling the note
 *   - a whole song mixed through both engines, compared and written to WAV
 *
 * Requires node-web-audio-api (OfflineAudioContext in Node):
 *   npm i node-web-audio-api        # or point WA_MODULE at its index.mjs
 *
 * Usage: node scripts/sf2-engine-ab.mjs [song.mid] [font.sf2]
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

const songPath = process.argv[2] || 'Y:/midi/Generation/Claude Opus 5.5/peach_blossom_crossing.mid';
const fontPath = process.argv[3] || 'resources/assets/Neo1MGM.sf2';
const outDir = path.join('test_samples', 'engine-ab');
const RATE = 44100;
const TRIM = Math.pow(10, -12 / 20);

const fontBuf = fs.readFileSync(fontPath);
const fontAb = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);

/** Minimal PicoAudio-alike for the renderers. */
function makeHost(ctx, engine) {
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    return {
        context: ctx,
        states: { startTime: 0 },
        baseLatency: 0,
        masterGainNode: master,
        settings: { generateVolume: 0.15, sf2Engine: engine },
        channels: new Array(17).fill(null).map(() => [0, 0, 1]),
    };
}

function writeWav(file, left, right, frames) {
    const bytes = frames * 4;
    const buf = Buffer.alloc(44 + bytes);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + bytes, 4); buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
    buf.writeUInt32LE(RATE, 24); buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32);
    buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(bytes, 40);
    for (let i = 0, o = 44; i < frames; i++) {
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), o); o += 2;
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), o); o += 2;
    }
    fs.writeFileSync(file, buf);
}

const mb = (n) => (n / 1048576).toFixed(1);
/** 100ms RMS envelope in dB (mono sum). */
function envelope(left, right, frames, winMs = 100) {
    const win = Math.round((winMs / 1000) * RATE);
    const out = [];
    for (let s = 0; s + win <= frames; s += win) {
        let sum = 0;
        for (let i = s; i < s + win; i++) {
            const m = (left[i] + right[i]) * 0.5;
            sum += m * m;
        }
        out.push(20 * Math.log10(Math.max(Math.sqrt(sum / win), 1e-9)));
    }
    return out;
}
const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    return { median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

/**
 * Fundamental frequency estimate (normalised autocorrelation peak) and the
 * best lag correlation between two windows - a cheap way to catch a wrong
 * playback rate / octave shift, which the envelope comparison cannot see.
 */
function pitchAndMatch(a, b, from, to, rate) {
    const start = Math.round(from * rate), end = Math.round(to * rate);
    const n = end - start;
    const mix = (x, i) => (x[i * 2] + x[i * 2 + 1]) * 0.5;
    const f0 = (x, i0) => {
        let best = 0, bestLag = 0;
        for (let lag = Math.round(rate / 2000); lag < Math.round(rate / 40); lag++) {
            let num = 0, den1 = 0, den2 = 0;
            for (let i = 0; i < n - lag; i += 2) {
                const v1 = mix(x, i0 + i), v2 = mix(x, i0 + i + lag);
                num += v1 * v2; den1 += v1 * v1; den2 += v2 * v2;
            }
            const c = num / Math.sqrt(Math.max(den1 * den2, 1e-20));
            if (c > best) { best = c; bestLag = lag; }
        }
        return rate / bestLag;
    };
    const fa = f0(a, start), fb = f0(b, start);
    // waveform match: best correlation over small lags (resampler differences
    // shift the waveform slightly, so allow up to ~10ms)
    let best = -1, bestShift = 0;
    for (let lag = -Math.round(0.01 * rate); lag <= Math.round(0.01 * rate); lag += 2) {
        let num = 0, den1 = 0, den2 = 0;
        for (let i = 0; i < n; i += 3) {
            const i1 = start + i, i2 = start + i + lag;
            if (i2 < 0 || i2 >= a.length / 2) continue;
            const v1 = (a[i1 * 2] + a[i1 * 2 + 1]) * 0.5;
            const v2 = (b[i2 * 2] + b[i2 * 2 + 1]) * 0.5;
            num += v1 * v2; den1 += v1 * v1; den2 += v2 * v2;
        }
        const c = num / Math.sqrt(Math.max(den1 * den2, 1e-20));
        if (c > best) { best = c; bestShift = lag; }
    }
    return { f0Dsp: fa, f0Graph: fb, ratio: fb / fa, match: best, shiftMs: (bestShift / rate) * 1000 };
}

/* ------------------------------------------------------------- per note -- */

const CASES = [
    { label: 'piano C4', program: 0, key: 60, vel: 100, secs: 2 },
    { label: 'piano E6', program: 0, key: 88, vel: 100, secs: 2 },
    { label: 'piano C2', program: 0, key: 36, vel: 80, secs: 2 },
    { label: 'strings loop', program: 48, key: 55, vel: 90, secs: 3 },
    { label: 'organ loop', program: 16, key: 60, vel: 100, secs: 3 },
    { label: 'drum ch9', program: 0, key: 36, vel: 100, secs: 1, drum: true },
    { label: 'hihat ch9', program: 0, key: 42, vel: 100, secs: 1, drum: true },
    { label: 'flute', program: 73, key: 70, vel: 100, secs: 2 },
    { label: 'trumpet', program: 56, key: 60, vel: 100, secs: 2 },
    { label: 'guitar', program: 24, key: 50, vel: 100, secs: 2 },
    { label: 'organ 16', program: 16, key: 60, vel: 100, secs: 2 },
];

console.log(`font: ${fontPath}\n== per note: graph vs DSP (after matching the -12 dB trim)`);
console.log('case         | level diff | envelope diff (median/p90) | correlation | pitch | wf match | sched DSP | sched graph');

const ctxDsp = new OfflineAudioContext(2, RATE, RATE);
loadSF2(ctxDsp, fontAb);
const font = getSF2Font();

for (const c of CASES) {
    const isDrum = !!c.drum;
    const presetIndex = getSF2PresetIndex(c.program, isDrum, isDrum ? 128 : 0, c.key, c.vel);
    const frames = Math.round(c.secs * RATE);

    // --- DSP reference (raw PCM, trim applied manually) ---
    let t0 = performance.now();
    const dsp = font.renderNote(presetIndex, c.key, c.vel / 127, frames, frames, null, null, 'linear');
    const dspMs = performance.now() - t0;
    const dspL = new Float32Array(frames);
    const dspR = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        dspL[i] = (dsp.data[i * 2] || 0) * TRIM;
        dspR[i] = (dsp.data[i * 2 + 1] || 0) * TRIM;
    }

    // --- Web Audio graph ---
    const ctx = new OfflineAudioContext(2, frames, RATE);
    loadSF2(ctx, fontAb);
    const host = makeHost(ctx, 'webaudio');
    t0 = performance.now();
    const stopFn = renderSF2NoteWebAudio.call(host, {
        startTime: 0, stopTime: c.secs, instrument: c.program, pitch: c.key,
        velocity: c.vel / 127, channel: isDrum ? 9 : 0, isDrum,
        midiVelocity: c.vel, midiVolume: 127, midiExpression: 127,
    });
    const graphMs = performance.now() - t0;
    const rendered = await ctx.startRendering();
    const graphL = rendered.getChannelData(0);
    const graphR = rendered.getChannelData(1);

    // --- compare ---
    const envDsp = envelope(dspL, dspR, frames);
    const envGraph = envelope(graphL, graphR, frames);
    const diffs = envDsp.map((v, i) => v - envGraph[i]);
    const med = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const shape = diffs.map((d) => Math.abs(d - med));
    const st = stats(shape);
    const rms = (l, r) => { let s = 0; for (let i = 0; i < frames; i++) { const m = (l[i] + r[i]) * 0.5; s += m * m; } return Math.sqrt(s / frames); };
    const levelDsp = 20 * Math.log10(Math.max(rms(dspL, dspR), 1e-9));
    const levelGraph = 20 * Math.log10(Math.max(rms(graphL, graphR), 1e-9));
    let corrN = 0, corrA = 0, corrB = 0;
    const mD = envDsp.reduce((a, b) => a + b, 0) / envDsp.length;
    const mG = envGraph.reduce((a, b) => a + b, 0) / envGraph.length;
    for (let i = 0; i < envDsp.length; i++) {
        corrN += (envDsp[i] - mD) * (envGraph[i] - mG);
        corrA += (envDsp[i] - mD) ** 2;
        corrB += (envGraph[i] - mG) ** 2;
    }
    const corr = corrN / Math.sqrt(corrA * corrB);

    const dspInter = new Float32Array(frames * 2);
    const graphInter = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
        dspInter[i * 2] = dspL[i]; dspInter[i * 2 + 1] = dspR[i];
        graphInter[i * 2] = graphL[i]; graphInter[i * 2 + 1] = graphR[i];
    }
    const pitch = pitchAndMatch(dspInter, graphInter, Math.min(0.3, c.secs * 0.4), Math.min(1.3, c.secs - 0.1), RATE);

    console.log(`${c.label.padEnd(12)} | ${(levelGraph - levelDsp).toFixed(2).padStart(6)} dB | `
        + `${st.median.toFixed(2).padStart(6)} / ${st.p90.toFixed(2).padStart(5)} dB | ${corr.toFixed(4).padStart(11)} | `
        + `${pitch.ratio.toFixed(3).padStart(5)} | ${pitch.match.toFixed(3).padStart(8)} | `
        + `${dspMs.toFixed(2).padStart(7)}ms | ${graphMs.toFixed(2).padStart(9)}ms`);
    if (process.env.SF2_AB_VERBOSE) {
        if (process.env.SF2_AB_WINDOWS) {
            console.log('   window  dsp dB  graph dB  diff dB');
            for (let i = 0; i < envDsp.length; i++) {
                console.log(`   ${(i * 0.1).toFixed(1).padStart(6)}s ${envDsp[i].toFixed(1).padStart(7)} `
                    + `${envGraph[i].toFixed(1).padStart(9)} ${(envDsp[i] - envGraph[i]).toFixed(2).padStart(8)}`);
            }
        }
        const peak = (l, r) => { let m = 0; for (let i = 0; i < frames; i++) m = Math.max(m, Math.abs(l[i]), Math.abs(r[i])); return m; };
        console.log(`   dsp rms ${levelDsp.toFixed(2)} dB peak ${peak(dspL, dspR).toFixed(3)} | `
            + `graph rms ${levelGraph.toFixed(2)} dB peak ${peak(graphL, graphR).toFixed(3)}`);
        const voices = (await import('../lib/PicoAudio/src/player/sf2/tsf-synth.js'))
            .noteOnVoices(font, presetIndex, c.key, c.vel / 127);
        voices.forEach((v, i) => {
            const r = v.region;
            const sh = font.shdrs[r.sampleId];
            console.log(`   voice${i}: sample ${sh.name} rate ${sh.sampleRate} shdr ${sh.start}-${sh.end}`
                + ` offset ${r.offset} loop ${r.loopMode} [${r.loopStart},${r.loopEnd}]`
                + ` gaindB ${v.noteGainDB.toFixed(2)} env a/h/d/s/r ${r.ampEnv.attack.toFixed(3)}/${r.ampEnv.hold.toFixed(3)}/${r.ampEnv.decay.toFixed(3)}/${r.ampEnv.sustain.toFixed(3)}/${r.ampEnv.release.toFixed(3)}`
                + ` fc ${r.initialFilterFc}`);
            console.log(`      mod: fcLfo ${r.modLfoToFilterFc} pitchLfo ${r.modLfoToPitch} vibPitch ${r.vibLfoToPitch}`
                + ` volLfo ${r.modLfoToVolume} freqModLFO ${r.freqModLFO} freqVib ${r.freqVibLFO}`
                + ` envPitch ${r.modEnvToPitch} envFc ${r.modEnvToFilterFc} Q ${r.initialFilterQ}`);
        });
    }

    fs.mkdirSync(outDir, { recursive: true });
    const tag = c.label.replace(/\W+/g, '_');
    writeWav(path.join(outDir, `${tag}.dsp.wav`), dspL, dspR, frames);
    writeWav(path.join(outDir, `${tag}.graph.wav`), graphL, graphR, frames);
    if (!stopFn) console.warn(`   (no stop function returned for ${c.label})`);
}

console.log(`\nwav pairs written to ${outDir}/`);
