/**
 * Renders a whole song through PicoAudio's own offline render path (the same
 * one the app's WAV export uses) with both SF2 engines, in a real browser, and
 * compares the results.
 *
 * This is the end to end check: it goes through the player's scheduling, the
 * channel/expression gains, the reverb and chorus, so a difference here is a
 * difference the user actually hears. It also watches every AudioParam call
 * for a negative time, which throws in Chrome and silently kills the note.
 */
import PicoAudio from '/lib/PicoAudio/src/main.js';

const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const results = { info: {}, stats: [], badTimes: [], ua: navigator.userAgent };
const say = (s) => { out.textContent += s + '\n'; };

const paramCalls = { total: 0, negative: 0, past: 0, negativeSamples: [], pastSamples: [] };
const liveContexts = new Set();
for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime',
    'setTargetAtTime', 'setValueCurveAtTime', 'cancelScheduledValues']) {
    const orig = AudioParam.prototype[method];
    if (!orig) continue;
    AudioParam.prototype[method] = function (a, b, c) {
        const time = method === 'setValueCurveAtTime' ? b : (method === 'cancelScheduledValues' ? a : b);
        if (typeof time === 'number') {
            paramCalls.total++;
            if (time < 0) {
                paramCalls.negative++;
                if (paramCalls.negativeSamples.length < 5) paramCalls.negativeSamples.push(`${method}(${time})`);
            } else {
                for (const ctx of liveContexts) {
                    if (time < ctx.currentTime) {
                        paramCalls.past++;
                        if (paramCalls.pastSamples.length < 5) {
                            paramCalls.pastSamples.push(`${method}(${time.toFixed(2)} < ${ctx.currentTime.toFixed(2)})`);
                        }
                        break;
                    }
                }
            }
        }
        return orig.call(this, a, b, c);
    };
}

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
const midiAb = await (await fetch('/__song.mid')).arrayBuffer();
const engine = new URLSearchParams(location.search).get('engine') || 'webaudio';

let phase = 'construct';
window.addEventListener('error', (e) => { results.phaseError = `${phase}: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => {
    results.phaseError = `${phase}: unhandled ${e.reason && e.reason.message}`;
});
const app = new PicoAudio({ sf2Engine: engine });
phase = 'init'; say('boot: constructed');
app.init();
phase = 'loadSF2'; say('boot: init done');
liveContexts.add(app.context);
app.context.resume && app.context.resume().catch(() => {});
app.loadSF2(fontAb);
phase = 'parseSMF'; say('boot: sf2 loaded');
const parsed = app.parseSMF(midiAb);
phase = 'setData'; say('boot: smf parsed');
app.setData(parsed);
phase = 'playData'; say('boot: data set');
const playData = app.playData;
const seconds = Math.min(Number(params.get('secs') || 30), Math.ceil(playData.lastEventTime));
const RATE = app.context.sampleRate;
results.info = {
    seconds, sampleRate: RATE, events: playData.lastEventTime,
    notes: playData.channels.reduce((n, c) => n + c.notes.length, 0),
    engine, settings: { ...app.settings },
};
say(`${results.info.notes} notes, ${playData.lastEventTime.toFixed(1)}s, rendering ${seconds}s on ${engine}`);

/** Renders `seconds` of the loaded song through one engine, offline. */
async function renderWith(engineName) {
    const frames = Math.round(seconds * RATE);
    const ctx = new OfflineAudioContext(2, frames, RATE);
    const p = new PicoAudio({ audioContext: ctx });
    for (const key in app.settings) p.settings[key] = app.settings[key];
    p.settings.sf2Engine = engineName;
    p.loadSF2(fontAb);
    p.setData(playData);
    const t0 = performance.now();
    const buffer = await p.render();
    return { buffer, ms: performance.now() - t0, ctx };
}

const realtimeContexts = new Set([...liveContexts]);
liveContexts.clear();
const dsp = await renderWith('dsp');
say(`dsp render: ${dsp.ms.toFixed(0)}ms`);
const graph = await renderWith('webaudio');
say(`webaudio render: ${graph.ms.toFixed(0)}ms`);
results.perf = { dspMs: dsp.ms, graphMs: graph.ms, seconds };
liveContexts.add(app.context);

/* --------------------------------------------------------- comparison -- */

results.phase = phase;

const N = Math.round(seconds * RATE);
const a = [dsp.buffer.getChannelData(0), dsp.buffer.getChannelData(1)];
const b = [graph.buffer.getChannelData(0), graph.buffer.getChannelData(1)];

/** In place radix 2 FFT, returns magnitude spectrum of a 2048 sample window. */
function spectrum(l, r, start) {
    const n = 2048;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
        re[i] = ((l[start + i] || 0) + (r[start + i] || 0)) * 0.5 * w;
    }
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
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
    const mag = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i], im[i]) / n;
    return mag;
}

const BANDS = [[0, 400], [400, 1200], [1200, 3000], [3000, 6000], [6000, 11000], [11000, 20000]];
const bandIndex = BANDS.map(([lo, hi]) => [
    Math.round((lo / (RATE / 2)) * 1024), Math.round((hi / (RATE / 2)) * 1024)]);
const bandEnergy = (mag, i) => {
    let s = 0;
    for (let k = bandIndex[i][0]; k < Math.min(bandIndex[i][1], mag.length); k++) s += mag[k] * mag[k];
    return 20 * Math.log10(Math.max(Math.sqrt(s / Math.max(1, bandIndex[i][1] - bandIndex[i][0])), 1e-12));
};
const centroidOf = (mag) => {
    let num = 0, den = 0;
    for (let k = 1; k < mag.length; k++) { const f = (k * RATE) / 2048; num += f * mag[k]; den += mag[k]; }
    return den > 0 ? num / den : 0;
};

const win = RATE / 2;
say('\n  t     | lvl dsp/graph   dB  | centroid dsp/graph Hz | band diffs dB (low->high)');
const windows = [];
for (let s = 0; s + win * 2 < N; s += win) {
    const rms = (ch, from) => {
        let acc = 0;
        for (let i = from; i < from + win; i++) { const m = (ch[0][i] + ch[1][i]) * 0.5; acc += m * m; }
        return Math.sqrt(acc / win);
    };
    const rd = rms(a, s), rg = rms(b, s);
    const seed = s + win / 2;
    const sd = spectrum(a[0], a[1], seed), sg = spectrum(b[0], b[1], seed);
    const diffs = BANDS.map((_, i) => bandEnergy(sg, i) - bandEnergy(sd, i));
    const cda = centroidOf(sd), cgb = centroidOf(sg);
    windows.push({ t: s / RATE, rd, rg, diff: diffs, cda, cgb });
    if (windows.length % 4 === 0 || Math.abs(20 * Math.log10(rg / rd)) > 1) {
        say(`${(s / RATE).toFixed(1).padStart(6)} | ${(20 * Math.log10(rd)).toFixed(1).padStart(6)}/${(20 * Math.log10(rg)).toFixed(1).padStart(6)} `
            + `${(20 * Math.log10(rg / rd)).toFixed(2).padStart(6)} | ${cda.toFixed(0).padStart(5)}/${cgb.toFixed(0).padStart(5)} | `
            + diffs.map((d) => d.toFixed(1).padStart(5)).join(' '));
    }
}
results.windows = windows;
results.badTimes = paramCalls;
say(`\nAudioParam calls: ${paramCalls.total}, negative times: ${paramCalls.negative} `
    + `${paramCalls.negativeSamples.join(', ')}, past times: ${paramCalls.past} ${paramCalls.pastSamples.join(', ')}`);

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
