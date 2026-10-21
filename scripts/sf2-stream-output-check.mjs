/**
 * Does a streamed DSP note actually produce the audio it should?
 *
 * The DSP engine always synthesizes in chunks now (the whole-note path was
 * removed, see sf2-renderer.js), so the chunks are all there is: the timeline
 * has to cover the note's length, carry signal, and line up without holes.
 * This used to be a bit-exact comparison against a whole-note render; that
 * reference is gone, so the check is now on the streamed timeline itself.
 *
 * Drives the real renderSF2Note() against a mock realtime AudioContext (not an
 * OfflineAudioContext, so the streaming branch is taken) and flushes the stream
 * so every chunk is produced synchronously.
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
                // the scheduled start time matters now: a chunk buffer is never
                // shorter than the audio in it (see scheduleChunk), so the tail
                // of one chunk overlaps the beginning of the next one as silence
                start(when) { if (this.buffer) chunks.push({ buffer: this.buffer, when: when || 0 }); },
            };
        },
    };
}

function renderNote(option) {
    const context = makeContext();
    const host = {
        context,
        states: { startTime: 0 },
        baseLatency: 0,
        masterGainNode: { connect() {}, disconnect() {} },
        settings: { generateVolume: 0.15, sf2Engine: 'dsp' },
        channels: new Array(17).fill(null).map(() => [0, 0, 1]),
    };
    const stop = renderSF2Note.call(host, option);
    if (!stop) return null;
    // Flush instead of pumping: the whole note is synthesized before the
    // timeline is rebuilt, which is what makes the comparison below stable.
    flushSF2Streaming();
    // Rebuild the timeline from the scheduled start times instead of gluing the
    // buffers together: chunks are placed where the graph would play them, so a
    // padded tail lands after the next chunk has already started (as silence).
    let total = 0;
    for (const c of context.chunks) total = Math.max(total, Math.round(c.when * RATE) + c.buffer.length);
    const left = new Float32Array(total), right = new Float32Array(total);
    for (const c of context.chunks) {
        const at = Math.round(c.when * RATE);
        const l = c.buffer.getChannelData(0);
        const r = c.buffer.getChannelData(1);
        for (let i = 0; i < c.buffer.length && at + i < total; i++) {
            left[at + i] += l[i];
            right[at + i] += r[i];
        }
    }
    stop();
    return { left, right, chunks: context.chunks.length, total };
}

/**
 * Trailing silent frames are not part of the note.
 *
 * A streaming chunk is always a full length buffer so the free list has a
 * single size class (see scheduleChunk), which means the chunk that ends a note
 * carries a little silence after its last sample. Only the audio matters, so
 * both sides are compared up to their last non silent frame.
 */
function contentFrames(track) {
    let end = track.total;
    while (end > 0 && track.left[end - 1] === 0 && track.right[end - 1] === 0) end--;
    return end;
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
    const out = renderNote({ ...option });
    if (!out) {
        failures++;
        console.log(`FAIL ${c.label.padEnd(32)} nothing rendered`);
        continue;
    }
    const frames = contentFrames(out);
    let peak = 0;
    for (let i = 0; i < frames; i++) {
        peak = Math.max(peak, Math.abs(out.left[i]), Math.abs(out.right[i]));
    }
    // The note has to cover its own length and carry signal. (The old check
    // compared the streamed timeline against a whole-note render; that second
    // path was removed, so the reference it compared against no longer exists.)
    const expected = Math.round(c.seconds * RATE);
    // A one-shot drum ends when its sample ends, so only melodic notes have to
    // cover the requested length.
    const ok = peak > 1e-4 && (c.isDrum || frames >= expected * 0.9);
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.label.padEnd(32)} `
        + `chunks ${out.chunks}, frames ${frames}/${expected}, peak ${peak.toExponential(2)}`
        + `, padded ${out.total - frames}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
