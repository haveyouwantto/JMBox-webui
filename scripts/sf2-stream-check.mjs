/**
 * Streaming note synthesis checks.
 *
 * 1. Identity: a note rendered in chunks must be sample identical to the same
 *    note rendered in one go (including pitch bend / pan automation, which has
 *    to survive across chunk boundaries).
 * 2. Cost: how long the note-on call blocks for notes of increasing length,
 *    whole-buffer vs streamed (lead chunks only).
 * 3. Memory: how much PCM exists at note-on for the same notes.
 *
 * Usage: node scripts/sf2-stream-check.mjs [font.sf2]
 */
import fs from 'fs';
import { loadTSFFont } from '../lib/PicoAudio/src/player/sf2/tsf.js';
import { createNoteRenderer } from '../lib/PicoAudio/src/player/sf2/tsf-synth.js';

const RATE = 44100;
const CHUNK_SECONDS = 1;
const LEAD_CHUNKS = 2;
const FONT = process.argv[2] || 'resources/assets/Neo1MGM.sf2';

const buf = fs.readFileSync(FONT);
const font = loadTSFFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), RATE, 0);
const strings = font.getPresetIndex(0, 48);   // sustained, looping, long release
const piano = font.getPresetIndex(0, 0);

/* ------------------------------------------------------------ identity -- */

function renderChunked(presetIndex, key, vel, noteFrames, maxFrames, chunkFrames, pitchBends, panChanges) {
    const renderer = createNoteRenderer(font, presetIndex, key, vel, noteFrames, maxFrames, pitchBends, panChanges, 'linear');
    const scratch = new Float32Array(chunkFrames * 2);
    const parts = [];
    while (!renderer.isDone()) {
        const written = renderer.render(chunkFrames, scratch);
        if (!written) break;
        parts.push(scratch.slice(0, written * 2));
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Float32Array(total);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return { data: all, frames: all.length / 2, chunks: parts.length };
}

console.log(`font: ${FONT}\n== identity: chunked vs single shot`);
const cases = [
    { label: 'piano 2s', preset: piano, key: 60, vel: 100 / 127, secs: 2, bends: null, pans: null },
    {
        label: 'strings 8s + bend/pan',
        preset: strings,
        key: 55,
        vel: 90 / 127,
        secs: 8,
        bends: [{ frame: 0, value: 0 }, { frame: 44100, value: -2 }, { frame: 132300, value: 1.5 }],
        pans: [{ frame: 0, value: 0.5 }, { frame: 88200, value: 0.9 }],
    },
    { label: 'strings 20s', preset: strings, key: 48, vel: 100 / 127, secs: 20, bends: null, pans: null },
];

for (const c of cases) {
    const frames = Math.round(c.secs * RATE);
    const whole = font.renderNote(c.preset, c.key, c.vel, frames, frames, c.bends, c.pans, 'linear');
    const chunked = renderChunked(c.preset, c.key, c.vel, frames, frames, Math.round(CHUNK_SECONDS * RATE), c.bends, c.pans);
    let maxDiff = 0;
    const n = Math.min(whole.data.length, chunked.data.length);
    for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(whole.data[i] - chunked.data[i]));
    const lengthOk = whole.frames === chunked.frames;
    console.log(`${c.label.padEnd(24)} | ${chunked.chunks} chunks | frames ${whole.frames}/${chunked.frames} ${lengthOk ? 'ok' : 'MISMATCH'}`
        + ` | max sample diff ${maxDiff === 0 ? '0 (identical)' : maxDiff.toExponential(2)}`);
    if (!lengthOk || maxDiff !== 0) throw new Error(`${c.label}: chunked render differs from the single shot render`);
}

/* ------------------------------------------------------- cost / memory -- */

function timeNote(secs, chunked) {
    const frames = Math.round(secs * RATE);
    // warm up
    font.renderNote(strings, 60, 100 / 127, Math.round(0.5 * RATE), Math.round(0.5 * RATE), null, null, 'linear');
    const t0 = performance.now();
    let pcm;
    if (chunked) {
        const renderer = createNoteRenderer(font, strings, 60, 100 / 127, frames, frames, null, null, 'linear');
        const scratch = new Float32Array(Math.round(CHUNK_SECONDS * RATE) * 2);
        pcm = 0;
        for (let i = 0; i < LEAD_CHUNKS && !renderer.isDone(); i++) {
            const written = renderer.render(scratch.length / 2, scratch);
            pcm += written * 2 * 4;
            if (!written) break;
        }
    } else {
        const r = font.renderNote(strings, 60, 100 / 127, frames, frames, null, null, 'linear');
        pcm = r.frames * 2 * 4;
    }
    return { ms: performance.now() - t0, mb: pcm / 1048576 };
}

console.log('\n== note-on blocking cost (sustained strings, one note)');
console.log('note length | whole buffer        | streamed (3x1s lead)');
for (const secs of [1, 2, 8, 16, 32, 60]) {
    const whole = timeNote(secs, false);
    const streamed = timeNote(secs, true);
    console.log(`${String(secs).padStart(6)}s    | ${whole.ms.toFixed(1).padStart(6)} ms ${whole.mb.toFixed(1).padStart(6)} MB | `
        + `${streamed.ms.toFixed(1).padStart(6)} ms ${streamed.mb.toFixed(1).padStart(5)} MB`
        + `   (${(whole.ms / Math.max(streamed.ms, 0.01)).toFixed(0)}x less blocking)`);
}

console.log('\nAll checks passed (chunked output is bit identical to single shot).');
