/**
 * Runs inside a real browser (driven by scripts/browser-bench.mjs). It renders
 * the same notes through both SF2 engines with the browser's own Web Audio and
 * probes how the browser treats automation scheduled in the past - the two
 * things the Node harness (node-web-audio-api) cannot answer.
 */
const params = new URLSearchParams(location.search);
const out = document.getElementById('out');
const RATE = Number(params.get('rate') || 44100);
const SECS = Number(params.get('secs') || 2);
const TRIM = Math.pow(10, -12 / 20);
const results = { cases: [], probe: {}, perf: {}, ua: navigator.userAgent };
const say = (s) => { out.textContent += s + '\n'; };

const player = '/lib/PicoAudio/src/player/';
const { loadSF2, getSF2Font, getSF2PresetIndex } = await import(player + 'sound-source/sf2-provider.js');
const { renderSF2NoteWebAudio } = await import(player + 'sound-source/sf2-webaudio-renderer.js');

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
const audioCtor = window.webkitAudioContext || window.AudioContext;

/** Minimal PicoAudio-alike host for the renderer. */
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

function envelope(left, right, n, winMs = 100) {
    const win = Math.round((winMs / 1000) * RATE);
    const res = [];
    for (let s = 0; s + win <= n; s += win) {
        let sum = 0;
        for (let i = s; i < s + win; i++) {
            const m = (left[i] + right[i]) * 0.5;
            sum += m * m;
        }
        res.push(20 * Math.log10(Math.max(Math.sqrt(sum / win), 1e-9)));
    }
    return res;
}

const rmsOf = (l, r, n) => {
    let s = 0;
    for (let i = 0; i < n; i++) { const m = (l[i] + r[i]) * 0.5; s += m * m; }
    return Math.sqrt(s / n);
};

/** Spectral centroid from the mean absolute sample delta - catches "duller". */
function centroid(l, r) {
    let num = 0, den = 0, prev = 0;
    for (let i = 1; i < l.length; i++) {
        const x = (l[i] + r[i]) * 0.5;
        const d = Math.abs(x - prev);
        prev = x;
        num += d * (i / l.length); den += d;
    }
    return den > 0 ? num / den : 0;
}

const CASES = [
    { label: 'piano C4', program: 0, key: 60, vel: 100 },
    { label: 'piano C4 short', program: 0, key: 60, vel: 100, noteOff: 0.25 },
    { label: 'piano C2', program: 0, key: 36, vel: 80 },
    { label: 'strings loop', program: 48, key: 55, vel: 90 },
    { label: 'trumpet', program: 56, key: 60, vel: 100 },
    { label: 'drum kick', program: 0, key: 36, vel: 100, drum: true },
];

const frames = Math.round(SECS * RATE);
const ctxFont = new OfflineAudioContext(2, RATE, RATE);
loadSF2(ctxFont, fontAb);
const font = getSF2Font();
say(`font: ${font.presets.length} presets, ${font.regionCount} regions`);

let schedDsp = 0, schedGraph = 0, renderGraph = 0;
for (const c of CASES) {
    const isDrum = !!c.drum;
    const presetIndex = getSF2PresetIndex(c.program, isDrum, isDrum ? 128 : 0, c.key, c.vel);
    const noteOff = Math.round((c.noteOff || SECS) * RATE);

    let t0 = performance.now();
    const dsp = font.renderNote(presetIndex, c.key, c.vel / 127, noteOff, frames, null, null, 'linear');
    schedDsp += performance.now() - t0;
    const dL = new Float32Array(frames), dR = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
        dL[i] = (dsp.data[i * 2] || 0) * TRIM;
        dR[i] = (dsp.data[i * 2 + 1] || 0) * TRIM;
    }

    const ctx = new OfflineAudioContext(2, frames, RATE);
    loadSF2(ctx, fontAb);
    const host = makeHost(ctx);
    t0 = performance.now();
    const stopFn = renderSF2NoteWebAudio.call(host, {
        startTime: 0, stopTime: c.noteOff || SECS, instrument: c.program, pitch: c.key,
        velocity: c.vel / 127, channel: isDrum ? 9 : 0, isDrum,
        midiVelocity: c.vel, midiVolume: 127, midiExpression: 127,
    });
    schedGraph += performance.now() - t0;
    t0 = performance.now();
    const rendered = await ctx.startRendering();
    renderGraph += performance.now() - t0;
    const gL = rendered.getChannelData(0), gR = rendered.getChannelData(1);

    const envD = envelope(dL, dR, frames), envG = envelope(gL, gR, frames);
    const diffs = envD.map((v, i) => v - envG[i]).slice().sort((a, b) => a - b);
    const med = diffs[Math.floor(diffs.length / 2)];
    let num = 0, da = 0, db = 0;
    const mD = envD.reduce((a, b) => a + b, 0) / envD.length;
    const mG = envG.reduce((a, b) => a + b, 0) / envG.length;
    for (let i = 0; i < envD.length; i++) {
        num += (envD[i] - mD) * (envG[i] - mG);
        da += (envD[i] - mD) ** 2; db += (envG[i] - mG) ** 2;
    }
    const corr = da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1;
    const rmsD = rmsOf(dL, dR, frames), rmsG = rmsOf(gL, gR, frames);
    const peak = (a) => { let m = 0; for (let i = 0; i < 4000 && i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; };
    const rec = {
        label: c.label,
        levelDiff: 20 * Math.log10(Math.max(rmsG, 1e-12) / Math.max(rmsD, 1e-12)),
        med, corr,
        centroidDsp: centroid(dL, dR),
        centroidGraph: centroid(gL, gR),
        peakDsp: peak(dL), peakGraph: peak(gL),
        stop: !!stopFn,
    };
    results.cases.push(rec);
    say(`case ${c.label}: level ${rec.levelDiff.toFixed(2)} dB | med ${med.toFixed(2)} dB | `
        + `corr ${corr.toFixed(4)} | centroid ${rec.centroidDsp.toFixed(4)}/${rec.centroidGraph.toFixed(4)}`);
}
results.perf.scheduleDspMs = schedDsp;
results.perf.scheduleGraphMs = schedGraph;
results.perf.renderGraphMs = renderGraph;

/* ------------------------------------------- realtime automation probe - */

async function probeRealtime() {
    const ctx = new audioCtor({ sampleRate: RATE });
    await ctx.resume().catch(() => {});
    // let the clock move so "a little in the past" is a positive time
    while (ctx.currentTime < 1) await new Promise((r) => setTimeout(r, 50));
    const now = ctx.currentTime;
    const curve = new Float32Array(64);
    for (let i = 0; i < 64; i++) curve[i] = i / 64;

    const attempt = (name, fn) => {
        try { fn(); return `${name}: ok`; } catch (e) { return `${name}: THREW ${e.name} - ${e.message}`; }
    };
    const p1 = ctx.createGain();
    const log = [
        attempt('curve at now-0.25', () => p1.gain.setValueCurveAtTime(curve, now - 0.25, 8)),
        attempt('curve at now+0.05', () => p1.gain.setValueCurveAtTime(curve, now + 0.05, 8)),
    ];
    const p2 = ctx.createGain();
    log.push(attempt('setValueAtTime now-0.25', () => p2.gain.setValueAtTime(0.5, now - 0.25)));
    log.push(attempt('expRamp now+0.5', () => p2.gain.exponentialRampToValueAtTime(0.1, now + 0.5)));
    const p4 = ctx.createGain();
    log.push(attempt('curve now-0.001', () => p4.gain.setValueCurveAtTime(curve, now - 0.001, 8)));
    log.push(attempt('curve now-0.25', () => p4.gain.setValueCurveAtTime(curve, now - 0.25, 8)));

    const p3 = ctx.createGain();
    p3.gain.value = 0;
    try { p3.gain.setValueCurveAtTime(curve, now - 0.05, 0.5); } catch (e) { log.push('past curve threw: ' + e.name); }
    const before = p3.gain.value;
    await new Promise((r) => setTimeout(r, 400));
    const after = p3.gain.value;
    results.probe = {
        log, currentTime: now, baseLatency: ctx.baseLatency,
        valueBefore: before, valueAfter: after, state: ctx.state, sampleRate: ctx.sampleRate,
    };
    say(log.join('\n'));
    say(`past curve gain: before ${before.toFixed(3)} after ${after.toFixed(3)} state ${ctx.state}`);
    await ctx.close();
}
await probeRealtime();

window.__BENCH__ = results;
document.title = 'BENCH-DONE';
