/**
 * Generate a stress MIDI file: notes at a fixed (unmusical) rate.
 *
 * The point is to drive the player far past any real song, so a profile of the
 * main thread shows the per event cost instead of being dominated by the audio
 * engine. Pair it with rt-profile.mjs?norender=1 to measure the scheduling
 * side alone, or without the flag to see where the two costs meet.
 *
 * Usage:
 *   node scripts/make-stress-midi.mjs --nps=2000 --secs=10 --len=50 --out=test_samples/stress-2000.mid
 *
 * Defaults: 2000 notes/s, 10 s, 50 ms per note, 16 channels, key range 30-89.
 * At 2000/s and 50 ms that is ~100 simultaneous notes, which is also past what
 * a real song asks for.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const NPS = Number(arg('nps', 2000));
const SECS = Number(arg('secs', 10));
const LEN_MS = Number(arg('len', 50));
const CHANNELS = Math.max(1, Math.min(16, Number(arg('channels', 16))));
const OUT = arg('out', `test_samples/stress-${NPS}.mid`);
const DIVISION = 9600;              // ticks per quarter note
const BPM = 120;
const TICKS_PER_SEC = DIVISION * (BPM / 60);

const vlq = (value) => {
    const bytes = [value & 0x7f];
    let v = value >> 7;
    while (v > 0) {
        bytes.unshift((v & 0x7f) | 0x80);
        v >>= 7;
    }
    return bytes;
};

// Keep one note per (channel, key) at a time: a second note-on with the same key
// on the same channel would be cancelled by the first note-off, which would make
// the sounding voice count lower than the note count and hide the cost this is
// meant to measure.
const freeAt = Array.from({ length: CHANNELS }, () => new Int32Array(128).fill(-1));

const events = [];
const total = Math.round(NPS * SECS);
const lenTicks = Math.max(1, Math.round((LEN_MS / 1000) * TICKS_PER_SEC));

let cursor = new Array(CHANNELS).fill(0);
for (let i = 0; i < total; i++) {
    const tick = Math.round((i / NPS) * TICKS_PER_SEC);
    const ch = i % CHANNELS;
    let key = 0;
    for (let tries = 0; tries < 60; tries++) {
        const candidate = 30 + (cursor[ch] % 60);
        cursor[ch]++;
        if (freeAt[ch][candidate] <= tick) { key = candidate; break; }
    }
    if (!key) key = 30 + (cursor[ch]++ % 60);
    freeAt[ch][key] = tick + lenTicks;
    const velocity = 40 + (i % 80);
    events.push({ tick, order: 1, bytes: [0x90 | ch, key, velocity] });
    events.push({ tick: tick + lenTicks, order: 0, bytes: [0x80 | ch, key, 0] });
}

events.sort((a, b) => a.tick - b.tick || a.order - b.order);

const track = [];
let lastTick = 0;
// Tempo: 500000 us per quarter note = 120 BPM.
track.push(0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20);
for (const ev of events) {
    track.push(...vlq(ev.tick - lastTick), ...ev.bytes);
    lastTick = ev.tick;
}
track.push(0x00, 0xff, 0x2f, 0x00);

const header = [
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6,
    0, 0,                      // format 0
    0, 1,                      // one track
    (DIVISION >> 8) & 0xff, DIVISION & 0xff,
];
const trackChunk = [
    0x4d, 0x54, 0x72, 0x6b,
    (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff,
    (track.length >>> 8) & 0xff, track.length & 0xff,
    ...track,
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from([...header, ...trackChunk]));

console.log(`${OUT}: ${total} notes over ${(total / NPS).toFixed(1)} s (${NPS}/s), `
    + `${LEN_MS} ms each, ${CHANNELS} channels, ${(NPS * LEN_MS / 1000).toFixed(0)} voices expected`);
