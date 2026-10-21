/**
 * Offline rendering still has to schedule every chunk before it returns.
 *
 * The DSP engine has one code path now: 0.25 s chunks, no whole-note render.
 * Offline (WAV export) is the case where nobody will come back to top up the
 * queue - startRendering() consumes the graph after the call returns - so the
 * chunks have to be drained and scheduled right there. This drives that branch
 * with a mock OfflineAudioContext and checks the timeline it produces.
 *
 * Usage: node scripts/sf2-offline-check.mjs
 */
import fs from 'fs';
import { loadSF2 } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { renderSF2Note } from '../lib/PicoAudio/src/player/sound-source/sf2-renderer.js';

const RATE = 44100;
const CHUNK = Math.round(0.25 * RATE);

// The renderer decides "offline" with instanceof, so the mock has to be one.
class FakeOfflineAudioContext {}
globalThis.OfflineAudioContext = FakeOfflineAudioContext;

const buf = fs.readFileSync('resources/assets/Neo1MGM.sf2');
loadSF2({ sampleRate: RATE }, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

function makeOfflineContext() {
    const param = () => {
        const p = { value: 0 };
        for (const fn of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'cancelScheduledValues']) {
            p[fn] = () => p;
        }
        return p;
    };
    const ctx = new FakeOfflineAudioContext();
    ctx.sampleRate = RATE;
    ctx.currentTime = 0;
    ctx.destination = { connect() {}, disconnect() {} };
    ctx.buffers = [];
    ctx.sources = [];
    ctx.createBuffer = (channels, length) => {
        const data = [];
        for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
        const b = { length, numberOfChannels: channels, sampleRate: RATE, getChannelData: (i) => data[i] };
        ctx.buffers.push(b);
        return b;
    };
    ctx.createBufferSource = () => {
        const s = {
            buffer: null, onended: null, startAt: [],
            connect() {}, disconnect() {},
            start(when) { s.startAt.push(when); }, stop() {},
        };
        ctx.sources.push(s);
        return s;
    };
    ctx.createGain = () => ({ gain: param(), connect() {}, disconnect() {} });
    return ctx;
}

const ctx = makeOfflineContext();
const host = {
    context: ctx,
    states: { startTime: 0 },
    baseLatency: 0.02,
    masterGainNode: { connect() {}, disconnect() {} },
    settings: { generateVolume: 0.15, sf2Quality: 'high' },
    channels: new Array(17).fill(null).map(() => [0, 0, 1]),
};

const START = 0.5;
const SECONDS = 1.5;
const stop = renderSF2Note.call(host, {
    startTime: START, stopTime: START + SECONDS, instrument: 0, pitch: 60,
    velocity: 100 / 127, channel: 0, midiVelocity: 100, midiVolume: 127, midiExpression: 127,
});
if (typeof stop !== 'function') throw new Error('offline note did not render');
if (ctx.sources.length < 2) {
    throw new Error(`expected the note to be drained into several chunks, got ${ctx.sources.length}`);
}

const starts = ctx.sources.map((s) => s.startAt[0]);
const expectedFirst = START + 0.02;
if (Math.abs(starts[0] - expectedFirst) > 1e-6) {
    throw new Error(`first chunk starts at ${starts[0]}, expected ${expectedFirst}`);
}
// Chunks are contiguous, not exactly 0.25 s: the synth renders in blocks of
// TSF_RENDER_EFFECTSAMPLEBLOCK and hands back the last whole block it finished,
// so a chunk can come out up to one block short and the next one starts there.
const BLOCK = 64;
for (let i = 1; i < starts.length; i++) {
    const delta = starts[i] - starts[i - 1];
    if (delta <= 0) throw new Error(`chunk ${i} does not advance the timeline (${delta})`);
    if (delta < CHUNK / RATE - BLOCK / RATE - 1e-9 || delta > CHUNK / RATE + 1e-9) {
        throw new Error(`chunk ${i} starts ${delta.toFixed(6)}s after the previous one, expected ~${(CHUNK / RATE).toFixed(6)}`);
    }
}

// Everything in the graph has to be scheduled now: nothing is left for a timer.
const queued = starts.length * CHUNK;
if (queued < SECONDS * RATE) {
    throw new Error(`only ${(queued / RATE).toFixed(2)}s scheduled for a ${SECONDS}s note`);
}
const tail = ctx.buffers.reduce((n, b) => n + b.length, 0);
let peak = 0;
for (const b of ctx.buffers) {
    const left = b.getChannelData(0);
    for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]));
}
if (!(peak > 1e-4)) throw new Error('offline render is silent');

console.log(`offline note ${SECONDS}s -> ${ctx.sources.length} chunks, ${(tail / RATE).toFixed(2)}s of buffer`);
console.log(`first start ${starts[0].toFixed(3)}s, chunk spacing ${((starts[1] - starts[0]) * 1000).toFixed(1)}ms, peak ${peak.toExponential(2)}`);
console.log('ok');
