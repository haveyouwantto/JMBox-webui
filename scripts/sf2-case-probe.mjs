/** Per case window-by-window comparison of the two SF2 engines. */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const waModule = process.env.WA_MODULE
    || path.join(process.env.TEMP || '/tmp', 'wa-test', 'node_modules', 'node-web-audio-api', 'index.js');
const { OfflineAudioContext } = await import(pathToFileURL(waModule).href);
const { loadSF2, getSF2Font, getSF2PresetIndex } = await import(
    '../lib/PicoAudio/src/player/sound-source/sf2-provider.js');
const { renderSF2NoteWebAudio } = await import(
    '../lib/PicoAudio/src/player/sound-source/sf2-webaudio-renderer.js');

const [, , fontPath, programArg, keyArg, velArg, secsArg] = process.argv;
const program = Number(programArg);
const key = Number(keyArg);
const vel = Number(velArg || 100);
const secs = Number(secsArg || 2);
const RATE = 44100;
const TRIM = Math.pow(10, -12 / 20);

const fontBuf = fs.readFileSync(fontPath);
const fontAb = fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength);
const quiet = console.log;
console.log = () => {};
loadSF2({ sampleRate: RATE }, fontAb);
const font = getSF2Font();
console.log = quiet;

const frames = Math.round(secs * RATE);
const pi = getSF2PresetIndex(program, false, 0, key, vel);
const dsp = font.renderNote(pi, key, vel / 127, frames, frames, null, null, 'linear');
const L = new Float32Array(frames), R = new Float32Array(frames);
for (let i = 0; i < frames; i++) { L[i] = (dsp.data[i * 2] || 0) * TRIM; R[i] = (dsp.data[i * 2 + 1] || 0) * TRIM; }

const host = {
    context: null, states: { startTime: 0 }, baseLatency: 0, masterGainNode: null,
    settings: { generateVolume: 0.15, sf2Engine: 'webaudio' },
    channels: new Array(17).fill(null).map(() => [0, 0, 1]),
};
const ctx = new OfflineAudioContext(2, frames, RATE);
console.log = () => {};
loadSF2(ctx, fontAb);
console.log = quiet;
const master = ctx.createGain();
master.gain.value = 1;
master.connect(ctx.destination);
host.context = ctx; host.masterGainNode = master;
renderSF2NoteWebAudio.call(host, {
    startTime: 0, stopTime: secs, instrument: program, pitch: key, velocity: vel / 127,
    channel: 0, isDrum: false, midiVelocity: vel, midiVolume: 127, midiExpression: 127,
});
const rendered = await ctx.startRendering();
const gl = rendered.getChannelData(0), gr = rendered.getChannelData(1);

/** Simple spectral centroid of a window (Goertzel-ish DFT on 512 bins). */
function centroid(l, r, from, n) {
    let num = 0, den = 0;
    for (let k = 1; k < 96; k++) {
        const f = (k * RATE) / 1024;
        let re = 0, im = 0;
        for (let i = 0; i < 1024; i++) {
            const s = ((l[from + i] || 0) + (r[from + i] || 0)) * 0.5;
            const a = (-2 * Math.PI * k * i) / 1024;
            re += s * Math.cos(a); im += s * Math.sin(a);
        }
        const mag = Math.hypot(re, im);
        num += f * mag; den += mag;
    }
    return den > 0 ? num / den : 0;
}

quiet(`prog ${program} key ${key} vel ${vel} -> ${font.presets[pi].name}`);
quiet('   t   | dsp dB | graph dB | diff | centroid dsp/graph');
const win = Math.round(0.1 * RATE);
for (let s = 0; s + win <= frames; s += win) {
    const rms = (x) => {
        let acc = 0;
        for (let i = s; i < s + win; i++) { const m = (x[0][i] + x[1][i]) * 0.5; acc += m * m; }
        return 20 * Math.log10(Math.max(Math.sqrt(acc / win), 1e-9));
    };
    const rd = rms([L, R]), rg = rms([gl, gr]);
    quiet(`${(s / RATE).toFixed(1).padStart(5)}s | ${rd.toFixed(1).padStart(6)} | ${rg.toFixed(1).padStart(8)} | `
        + `${(rg - rd).toFixed(2).padStart(5)} | ${centroid(L, R, s, 1024).toFixed(0)}/${centroid(gl, gr, s, 1024).toFixed(0)}`);
}
