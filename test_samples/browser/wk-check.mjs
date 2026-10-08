/**
 * End to end check of the AudioWorklet SF2 engine in a real browser: play a
 * note through the engine, capture what the worklet actually output, and
 * compare it with the DSP engine's render of the same note.
 *
 * The Node harness (scripts/sf2-worklet-check.mjs) already proves the mixing
 * math; this covers the parts only a browser has - the module loading, the
 * message plumbing, the master routing and the real audio clock.
 *
 * Usage: node scripts/browser-bench.mjs <font.sf2> <song.mid> --page=wk-check
 */
import PicoAudio from '/lib/PicoAudio/src/main.js';
import { captureSF2Worklet } from '/lib/PicoAudio/src/player/sound-source/sf2-worklet-renderer.js';
import { renderNote } from '/lib/PicoAudio/src/player/sf2/tsf-synth.js';
import { getSF2Font, getSF2PresetIndex } from '/lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const out = document.getElementById('out');
const say = (s) => { out.textContent += s + '\n'; console.log(s); };
const results = { ua: navigator.userAgent, cases: [], info: { engine: 'worklet' } };

const fontAb = await (await fetch('/__font.sf2')).arrayBuffer();
// parseSMF copies a Uint8Array but views an ArrayBuffer
const midiU8 = new Uint8Array(await (await fetch('/__song.mid')).arrayBuffer());

const app = new PicoAudio({ sf2Engine: 'worklet', soundQuality: 4 });
app.init();
await app.context.resume().catch(() => {});
app.loadSF2(fontAb);
app.setData(app.parseSMF(midiU8));
app.prepareSF2Worklet();
for (let i = 0; i < 200 && !app.isSF2WorkletReady(); i++) await new Promise((r) => setTimeout(r, 50));
if (!app.isSF2WorkletReady()) throw new Error('worklet engine never became ready');
say('worklet engine ready');

const font = getSF2Font();
const RATE = app.context.sampleRate;
const TRIM = Math.pow(10, -12 / 20);

const CASES = [
    { label: 'piano C4', instrument: 0, pitch: 60, midiVelocity: 100, seconds: 2 },
    { label: 'strings C4', instrument: 48, pitch: 60, midiVelocity: 90, seconds: 3 },
    { label: 'drum kick', instrument: 0, pitch: 36, midiVelocity: 110, seconds: 1, channel: 9 },
];

let worst = 0;
let failures = 0;
for (const c of CASES) {
    const isDrum = c.channel === 9;
    const presetIndex = getSF2PresetIndex(c.instrument, isDrum, isDrum ? 128 : 0, c.pitch, c.midiVelocity);

    // the engine's own note object, played through createNote -> worklet
    const option = {
        startTime: 0, stopTime: c.seconds, instrument: c.instrument, pitch: c.pitch,
        velocity: c.midiVelocity / 127, channel: c.channel || 0, isDrum,
        midiVelocity: c.midiVelocity, midiVolume: 127, midiExpression: 127,
        bank: isDrum ? 128 : 0,
    };

    // Capture a window that starts well before the note: the previous case's
    // tail must have died out, otherwise it leaks into the comparison.
    const fromSeconds = app.context.currentTime + 4;
    const captureSeconds = c.seconds + 0.5;
    const capture = captureSF2Worklet(app.context, fromSeconds, captureSeconds);
    const noteStart = fromSeconds;
    app.createNote({ ...option, startTime: noteStart, stopTime: noteStart + c.seconds });
    const data = await capture;

    // the DSP engine's render of the same note, scaled by the same output trim
    const noteFrames = Math.round(c.seconds * RATE);
    const dsp = renderNote(font, presetIndex, c.pitch, c.midiVelocity / 127,
        noteFrames, noteFrames + 30 * RATE, null, null, 'linear');

    // The engine starts the note at round((startTime + startTime0 + baseLatency) * rate)
    // and the capture begins at round(fromSeconds * rate), so the offset in the
    // captured buffer is exactly known - no correlation needed.
    const startSeconds = noteStart + (app.states.startTime || 0) + app.baseLatency;
    const bestOffset = Math.round(startSeconds * RATE) - Math.round(fromSeconds * RATE);
    let maxDiff = 0;
    let maxAt = 0;
    let over = 0;
    let peak = 0;
    const frames = Math.min(dsp.frames, data.length / 2 - bestOffset);
    // the capture must be silent before the note starts
    let lead = 0;
    for (let i = 0; i < bestOffset; i++) {
        lead = Math.max(lead, Math.abs(data[i * 2] || 0), Math.abs(data[i * 2 + 1] || 0));
    }
    for (let i = 0; i < frames; i++) {
        const refL = dsp.data[i * 2] * TRIM;
        const refR = dsp.data[i * 2 + 1] * TRIM;
        const d = Math.max(Math.abs((data[(bestOffset + i) * 2] || 0) - refL),
            Math.abs((data[(bestOffset + i) * 2 + 1] || 0) - refR));
        if (d > maxDiff) { maxDiff = d; maxAt = i; }
        if (d > 1e-4) over++;
        peak = Math.max(peak, Math.abs(refL));
    }
    worst = Math.max(worst, maxDiff);
    const ok = maxDiff <= 1e-6 + 1e-5 * peak && lead <= 1e-6;
    if (!ok) failures++;
    results.cases.push({ label: c.label, offsetFrames: bestOffset, maxDiff, maxAt, overFrames: over, frames, peak, lead });
    const probe = [0, 100, 175, 176, 177, 1000, 20000, maxAt]
        .filter((i) => i < frames)
        .map((i) => `${i}:${(data[(bestOffset + i) * 2] || 0).toFixed(7)}/${(dsp.data[i * 2] * TRIM).toFixed(7)}`);
    say(`     probe(idx:worklet/dsp) ${probe.join(' ')}`);
    say(`${ok ? 'OK  ' : 'FAIL'} ${c.label.padEnd(14)} offset ${String(bestOffset).padStart(5)} frames  `
        + `max |worklet - dsp| ${maxDiff.toExponential(2)} at ${maxAt}/${frames}  peak ${peak.toFixed(4)}  lead ${lead.toExponential(1)}`);
}

say(`\nworst difference: ${worst.toExponential(3)}`);
say(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
window.__BENCH__ = results;
document.title = 'BENCH-DONE';
