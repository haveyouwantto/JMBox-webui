/**
 * Streaming playback must be *sample identical* to whole-note playback.
 *
 * The DSP engine streams long notes in 1 second chunks, and the chunks are what
 * the listener actually hears, so any change to the streaming path (buffer
 * reuse, chunk size, lead chunks) has to be checked against the single-buffer
 * render - TSF is the reference and its output may not move.
 *
 * Drives the real renderSF2Note() against a mock realtime AudioContext (not an
 * OfflineAudioContext, so the streaming branch is taken), flushes the stream so
 * every chunk is produced synchronously, and compares the concatenated PCM.
 *
 * Usage: node scripts/sf2-stream-output-check.mjs [font.sf2]
 */
import fs from 'fs';
import { loadSF2 } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';
import { renderSF2Note, flushSF2Streaming } from '../lib/PicoAudio/src/player/sound-source/sf2-renderer.js';

const RATE = 44100;
const FONT = process.argv[2] || 'resources/assets/Neo1MGM.sf2';

const param = () => ({
    value: 0,
    setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueAtTime() {},
});

/** A mock realtime AudioContext that keeps every buffer it hands out. */
function makeContext() {
    const chunks = [];
    const node = () => ({
        connect() {}, disconnect() {}, start() {}, stop() {},
        gain: param(), pan: param(), frequency: param(), detune: param(), playbackRate: param(), Q: param(),
    });
    return {
        sampleRate: RATE,
        currentTime: 0,
        destination: node(),
        chunks,
        createGain: node,
        createStereoPanner: node,
        createPanner: node,
        createBiquadFilter: node,
        createOscillator: node,
        createConvolver: node,
        createDelay: node,
        createBuffer(channels, length, sampleRate) {
            const data = [];
            for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
            return {
                numberOfChannels: channels, length, sampleRate,
                duration: length / sampleRate, getChannelData: (i) => data[i],
            };
        },
        createBufferSource() {
            return {
                ...node(),
                buffer: null, loop: false, loopStart: 0, loopEnd: 0, onended: null,
                start() { if (this.buffer) chunks.push(this.buffer); },
            };
        },
    };
}

function renderNote(option, streaming) {
    const context = makeContext();
    const host = {
        context,
        states: { startTime: 0 },
        baseLatency: 0,
        masterGainNode: { connect() {}, disconnect() {} },
        settings: { generateVolume: 0.15, sf2Engine: 'dsp', sf2Streaming: streaming },
        channels: new Array(17).fill(null).map(() => [0, 0, 1]),
    };
    const stop = renderSF2Note.call(host, option);
    if (!stop) return null;
    if (streaming) flushSF2Streaming();
    // concatenate the chunks in the order the sources were started
    const total = context.chunks.reduce((n, b) => n + b.length, 0);
    const left = new Float32Array(total), right = new Float32Array(total);
    let at = 0;
    for (const buffer of context.chunks) {
        left.set(buffer.getChannelData(0), at);
        right.set(buffer.getChannelData(1), at);
        at += buffer.length;
    }
    stop();
    return { left, right, chunks: context.chunks.length, total };
}

function compare(a, b) {
    if (!a || !b) return { error: `missing output (stream ${!!a}, whole ${!!b})` };
    if (a.total !== b.total) return { error: `length differs: stream ${a.total} vs whole ${b.total}` };
    let maxDiff = 0, at = -1;
    for (let i = 0; i < a.total; i++) {
        const d = Math.max(Math.abs(a.left[i] - b.left[i]), Math.abs(a.right[i] - b.right[i]));
        if (d > maxDiff) { maxDiff = d; at = i; }
    }
    return { maxDiff, at, frames: a.total };
}

const buf = fs.readFileSync(FONT);
const fontAb = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
if (!loadSF2({ sampleRate: RATE }, fontAb)) throw new Error('loadSF2 failed');

const CASES = [
    { label: 'piano C4 (decay, long tail)', instrument: 0, pitch: 60, midiVelocity: 100, seconds: 6 },
    { label: 'strings C4 (looping sustain)', instrument: 48, pitch: 60, midiVelocity: 90, seconds: 8 },
    { label: 'organ C3 (loop + fast attack)', instrument: 16, pitch: 48, midiVelocity: 100, seconds: 7 },
    { label: 'drum kick (one shot)', instrument: 0, pitch: 36, midiVelocity: 110, seconds: 3, isDrum: true },
    { label: 'piano + pitch bend', instrument: 0, pitch: 62, midiVelocity: 100, seconds: 8, pitchBend: true },
];

let failures = 0;
console.log(`font: ${FONT}\n`);
for (const c of CASES) {
    const option = {
        startTime: 0, stopTime: c.seconds, instrument: c.instrument, pitch: c.pitch,
        velocity: c.midiVelocity / 127, channel: c.isDrum ? 9 : 0, isDrum: !!c.isDrum,
        midiVelocity: c.midiVelocity, midiVolume: 127, midiExpression: 127,
        pitchBend: c.pitchBend
            ? [{ time: 0, value: 0 }, { time: 1, value: 12 }, { time: 2, value: -12 }, { time: 3.5, value: 0 }]
            : undefined,
    };
    const streamed = renderNote({ ...option }, true);
    const whole = renderNote({ ...option }, false);
    const r = compare(streamed, whole);
    const ok = r.error === undefined && r.maxDiff === 0;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.label.padEnd(32)} `
        + (r.error ? r.error
            : `chunks ${streamed.chunks}/${whole.chunks}, frames ${r.frames}, max |diff| ${r.maxDiff}`
            + (r.maxDiff !== 0 ? ` at frame ${r.at}` : '')));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
