/**
 * Smoke test for the SF2 playback path with the TinySoundFont port:
 * load a font through the provider, render a note through sf2-renderer with a
 * mock AudioContext, and check the audio graph and the produced buffer.
 *
 * Run: node scripts/sf2-renderer-smoke.mjs
 */
import fs from 'fs';
import {
    loadSF2, getSF2Font, getSF2PresetIndex,
} from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { renderSF2Note } from '../lib/PicoAudio/src/player/sound-source/sf2-renderer.js';
import { flushSF2Streaming } from '../lib/PicoAudio/src/player/sound-source/sf2-renderer.js';

const created = { buffers: [], sources: [], gains: [] };

function audioParam(name) {
    const p = { name, value: 0, events: [] };
    for (const fn of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'setValueCurveAtTime']) {
        p[fn] = (...args) => { p.events.push([fn, ...args]); return p; };
    }
    return p;
}

const mockContext = {
    sampleRate: 44100,
    currentTime: 0,
    destination: { connect() {}, disconnect() {} },
    createBuffer(channels, length, sampleRate) {
        const data = [];
        for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
        const buffer = { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i] };
        created.buffers.push(buffer);
        return buffer;
    },
    createBufferSource() {
        const node = {
            buffer: null, playbackRate: audioParam('playbackRate'),
            connect() {}, disconnect() {}, startCalls: [], stopCalls: [],
            start(...a) { node.startCalls.push(a); }, stop(...a) { node.stopCalls.push(a); },
        };
        created.sources.push(node);
        return node;
    },
    createGain() {
        const node = { gain: audioParam('gain'), connect() {}, disconnect() {} };
        created.gains.push(node);
        return node;
    },
};

const buf = fs.readFileSync('test_samples/RLNDGM.sf2');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
if (!loadSF2(mockContext, ab)) throw new Error('loadSF2 failed');

const fakePicoAudio = {
    context: mockContext,
    states: { startTime: 0 },
    baseLatency: 0.02,
    masterGainNode: { connect() {}, disconnect() {} },
    // streaming off here: this block checks the single buffer path
    settings: { generateVolume: 0.15, sf2Streaming: false },
    channels: [0, 0, 1],
};

const stop = renderSF2Note.call(fakePicoAudio, {
    startTime: 0.5,
    stopTime: 1.5,
    instrument: 0,
    pitch: 60,
    velocity: 100 / 127,
    channel: 0,
});

if (typeof stop !== 'function') throw new Error('renderSF2Note did not return a stop function');
if (created.buffers.length !== 1) throw new Error(`expected 1 buffer, got ${created.buffers.length}`);
if (created.sources.length !== 1) throw new Error(`expected 1 source, got ${created.sources.length}`);

const buffer = created.buffers[0];
const left = buffer.getChannelData(0);
let peak = 0;
for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]));

const source = created.sources[0];
console.log('buffer frames      :', buffer.length, `(${(buffer.length / 44100).toFixed(2)}s)`);
console.log('peak               :', peak.toExponential(3));
console.log('source.start called:', JSON.stringify(source.startCalls));
console.log('start scheduled at :', source.startCalls[0] && source.startCalls[0][0]);
console.log('channel volumes    :', created.gains.map((g) => g.gain.events[0]));

stop();
console.log('stop() muted       :', created.gains.some((g) => g.gain.events.some(
    (e) => e[0] === 'setValueAtTime' && e[1] === 0)));

if (!(peak > 0.001)) throw new Error('rendered buffer is silent');
if (Math.abs(source.startCalls[0][0] - 0.52) > 1e-9) throw new Error('start time is not startTime + baseLatency');

// --- percussion regression: a channel 9 note must play a kit, never the
// melodic preset of the same program (bank 0 selects a piano otherwise) ---
const font = getSF2Font();
const melodicIndex = getSF2PresetIndex(0, false, 0, 36, 100);
const drumIndex = getSF2PresetIndex(0, true, 0, 36, 100);
console.log('\nmelodic preset for program 0:', melodicIndex, font.getPresetName(melodicIndex),
    '| bank', font.presets[melodicIndex].bank);
console.log('drum preset for program 0   :', drumIndex, font.getPresetName(drumIndex),
    '| bank', font.presets[drumIndex].bank);
if (drumIndex === melodicIndex) throw new Error('percussion resolved to the melodic preset');
if (font.presets[drumIndex].bank < 120) throw new Error('percussion resolved outside the kit banks');

const drum = font.renderNote(drumIndex, 36, 100 / 127, Math.round(0.05 * 44100), 44100);
const melodic = font.renderNote(melodicIndex, 36, 100 / 127, Math.round(0.05 * 44100), 44100);
let drumPeak = 0;
for (const v of drum.data) drumPeak = Math.max(drumPeak, Math.abs(v));
if (!(drumPeak > 0.001)) throw new Error('drum note rendered silence');
if (drum.frames === melodic.frames) throw new Error('drum note rendered identically to the melodic preset');
console.log('drum note renders  :', drum.frames, 'frames, peak', drumPeak.toExponential(3));

// --- and the renderer must route channel 9 to that kit ------------------
const drumStop = renderSF2Note.call(fakePicoAudio, {
    startTime: 2.0, stopTime: 2.05, instrument: 0, pitch: 36,
    velocity: 100 / 127, channel: 9, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
const melodicStop = renderSF2Note.call(fakePicoAudio, {
    startTime: 3.0, stopTime: 3.05, instrument: 0, pitch: 36,
    velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
const drumFrames = created.buffers[created.buffers.length - 2].length;
const melodicFrames = created.buffers[created.buffers.length - 1].length;
console.log('renderer channel 9  :', drumFrames, 'frames | channel 0:', melodicFrames, 'frames');
if (typeof drumStop !== 'function' || typeof melodicStop !== 'function') throw new Error('note did not render');
if (drumFrames === melodicFrames) throw new Error('channel 9 rendered the melodic preset');
drumStop(); melodicStop();

// --- interpolation setting must reach the engine ------------------------
function renderWithMode(mode) {
    fakePicoAudio.settings.sf2Interpolation = mode;
    const stopFn = renderSF2Note.call(fakePicoAudio, {
        startTime: 4.0, stopTime: 4.5, instrument: 0, pitch: 72,
        velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
    });
    if (typeof stopFn !== 'function') throw new Error(`no note rendered for ${mode}`);
    stopFn();
    return created.buffers[created.buffers.length - 1];
}
const bufLinear = renderWithMode('linear');
const bufDefault = renderWithMode(undefined);
const bufNearest = renderWithMode('nearest');
const bufCubic = renderWithMode('cubic');
const diff = (a, b) => {
    let m = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
};
const a = bufLinear.getChannelData(0);
console.log('interpolation       : linear vs default', diff(a, bufDefault.getChannelData(0)).toExponential(2),
    '| vs nearest', diff(a, bufNearest.getChannelData(0)).toExponential(2),
    '| vs cubic', diff(a, bufCubic.getChannelData(0)).toExponential(2));
if (diff(a, bufDefault.getChannelData(0)) !== 0) throw new Error('default interpolation is not linear');
if (diff(a, bufNearest.getChannelData(0)) === 0) throw new Error('nearest interpolation had no effect');
if (diff(a, bufCubic.getChannelData(0)) === 0) throw new Error('cubic interpolation had no effect');

// --- streaming: a long note is synthesized in chunks while it plays ------
fakePicoAudio.settings.sf2Streaming = true;
const buffersBefore = created.buffers.length;
const sourcesBefore = created.sources.length;
const noteSeconds = 20;
const longStop = renderSF2Note.call(fakePicoAudio, {
    startTime: 5.0, stopTime: 5.0 + noteSeconds, instrument: 0, pitch: 60,
    velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
if (typeof longStop !== 'function') throw new Error('long note did not render');
const chunks = created.buffers.slice(buffersBefore);
const starts = created.sources.slice(sourcesBefore).map((s) => s.startCalls[0][0]);
console.log('streaming 20s note :', chunks.length, 'chunks at note-on,',
    chunks.map((b) => b.length).join('+'), 'frames | whole note would be', noteSeconds * 44100);
console.log('chunk start times  :', starts.map((t) => t.toFixed(3)).join(', '));
if (chunks.length !== 3) throw new Error(`expected 3 lead chunks, got ${chunks.length}`);
if (chunks.reduce((n, b) => n + b.length, 0) >= noteSeconds * 44100 / 2) {
    throw new Error('streaming rendered too much of the note up front');
}
for (let i = 1; i < starts.length; i++) {
    const delta = starts[i] - starts[i - 1];
    if (delta <= 0 || delta > 1.01) throw new Error(`chunk ${i} is not scheduled right after the previous one (${delta}s)`);
}

longStop();
console.log('stop() cancels streaming synthesis:', true);

// Continue the same note with the fake clock moving: the pump must top the
// queue up on its own instead of waiting for the whole note.
const resumedStop = renderSF2Note.call(fakePicoAudio, {
    startTime: 5.0, stopTime: 5.0 + noteSeconds, instrument: 0, pitch: 60,
    velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
const primed = created.buffers.length;
mockContext.currentTime = 6.5; // playhead has caught up with the primed audio
await new Promise((resolve) => setTimeout(resolve, 350));
const afterPump = created.buffers.length;
console.log('pump after 0.35s   :', afterPump - primed, 'more chunks synthesized');
if (afterPump === primed) throw new Error('the streaming pump did not synthesize more audio');

resumedStop();
const afterStop = created.buffers.length;
await new Promise((resolve) => setTimeout(resolve, 400));
if (created.buffers.length !== afterStop) {
    throw new Error('the streaming timer kept synthesizing after the note was stopped');
}
console.log('stop() halts the pump:', true);

// --- flush: hidden tabs throttle timers, so the rest of a note is
// synthesized on demand instead of waiting for the pump ------------------
mockContext.currentTime = 0;
const flushStop = renderSF2Note.call(fakePicoAudio, {
    startTime: 8.0, stopTime: 28.0, instrument: 0, pitch: 60,
    velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
const primedForFlush = created.buffers.length;
const pendingAfterFlush = flushSF2Streaming();
const addedByFlush = created.buffers.length - primedForFlush;
await new Promise((resolve) => setTimeout(resolve, 400));
console.log('flush()           :', addedByFlush, 'more chunks synthesized,',
    pendingAfterFlush, 'streamers still pending,', created.buffers.length - primedForFlush, 'total');
if (addedByFlush < 10) throw new Error('flush did not synthesize the rest of the note');
if (created.buffers.length !== primedForFlush + addedByFlush) {
    throw new Error('a timer kept running after flush');
}
if (pendingAfterFlush !== 0) throw new Error('flush left active streamers behind');
flushStop();

console.log('\nok');
