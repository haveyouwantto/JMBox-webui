/**
 * Node leak soak test for PicoAudio's note playback.
 *
 * Simulates minutes of playback with a mock AudioContext and reports what the
 * audio graph still holds: live nodes, live buffer sources, referenced
 * AudioBuffer bytes and the JS heap. A "drain" phase at the end (no new notes,
 * clock keeps moving) separates a real leak from notes that are simply still
 * ringing.
 *
 * Notes are created the way the player does and their stop function is only
 * called when the whole song stops - notes that end on their own are dropped
 * from the stop list without being stopped, exactly like the player.
 *
 * Usage: node --expose-gc scripts/audio-soak-test.mjs <song.mid> [minutes] [font.sf2]
 *   SOAK_MODE=sf2|note|perc   sf2 (default) uses soundQuality=4, note uses the
 *                             built in modes, perc forces the drum path
 *   SOAK_QUALITY=0|1|3        sound quality for SOAK_MODE=note (default 1)
 *
 * The test runs the built library (lib/PicoAudio/dist/nodejs/picoaudio.mjs), so
 * run `npm run picoaudio` first when the sources changed.
 */
import fs from 'fs';
import PicoAudio from '../lib/PicoAudio/dist/nodejs/picoaudio.mjs';

// The library reads window.AudioContext / window.performance even when a
// context is injected, so give it a minimal window in Node.
if (typeof globalThis.window === 'undefined') {
    globalThis.window = { performance: globalThis.performance, Date: globalThis.Date };
}

const songPath = process.argv[2] || 'Y:/midi/Generation/Claude Opus 5.5/the_last_light_you_gave.mid';
const minutes = Number(process.argv[3] || 4);
const fontPath = process.argv[4] || 'resources/assets/Neo1MGM.sf2';
const MODE = process.env.SOAK_MODE || 'sf2';
const QUALITY = Number(process.env.SOAK_QUALITY || 1);
const RATE = 44100;

const stats = {
    liveNodes: 0, createdNodes: 0, liveSources: 0, createdSources: 0,
    bufferBytes: 0, peakBufferBytes: 0, liveByKind: {}, createdByKind: {},
};
let currentNote = null;          // note being created, so sources can be traced
const allSources = [];
const allNodes = [];
const started = [];              // every started source, so "ended" can be modelled

function makeContext() {
    const param = () => ({
        value: 0,
        setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
        linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setValueCurveAtTime() {},
    });
    const node = (kind) => {
        stats.createdNodes++;
        stats.liveNodes++;
        stats.createdByKind[kind] = (stats.createdByKind[kind] || 0) + 1;
        stats.liveByKind[kind] = (stats.liveByKind[kind] || 0) + 1;
        allNodes.push(null);   // placeholder, replaced below (keeps creation order)
        const n = {
            kind,
            _note: currentNote,
            connect() {},
            disconnect() {
                if (!n._disc) { n._disc = true; stats.liveNodes--; stats.liveByKind[kind]--; }
            },
            start() {}, stop() {},
            gain: param(), pan: param(), frequency: param(), detune: param(), playbackRate: param(),
            delayTime: param(), Q: param(),
            threshold: param(), knee: param(), ratio: param(), attack: param(), release: param(),
            buffer: null, normalize: false,
        };
        allNodes[allNodes.length - 1] = n;
        return n;
    };
    const ctx = {
        sampleRate: RATE,
        currentTime: 0,
        destination: node('destination'),
        createBuffer(channels, length, sampleRate) {
            const data = [];
            for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
            const bytes = length * channels * 4;
            stats.bufferBytes += bytes;
            stats.peakBufferBytes = Math.max(stats.peakBufferBytes, stats.bufferBytes);
            return {
                numberOfChannels: channels, length, sampleRate, _bytes: bytes,
                duration: length / sampleRate, getChannelData: (i) => data[i],
                copyToChannel(source, channelNumber) {
                    const target = data[channelNumber || 0];
                    if (target && target.length === source.length) target.set(source);
                    else data[channelNumber || 0] = new Float32Array(source);
                },
            };
        },
        createBufferSource: () => makeSource('source', true),
        createGain: () => node('gain'),
        createStereoPanner: () => node('panner'),
        createPanner: () => node('panner'),
        createChannelMerger: () => node('merger'),
        createBiquadFilter: () => node('filter'),
        createOscillator: () => makeSource('osc', false),
        createDynamicsCompressor: () => node('compressor'),
        createConvolver: () => node('convolver'),
        createDelay: () => node('delay'),
        createPeriodicWave: () => ({}),
        decodeAudioData: (data) => Promise.resolve(ctx.createBuffer(
            1, Math.max(1, Math.floor((data && data.byteLength ? data.byteLength : 44100) / 2)), RATE)),
    };
    function makeSource(kind, isBufferSource) {
        const n = node(kind);
        stats.createdSources++;
        stats.liveSources++;
        n.buffer = null;
        n.loop = false;
        n._start = null;
        n._stop = null;
        n._ended = false;
        n.onended = null;
        allSources.push(n);
        n.start = (when) => { n._start = when == null ? 0 : when; if (!isBufferSource) started.push(n); };
        n.stop = (when) => {
            const at = when == null ? 0 : when;
            n._stop = n._stop == null ? at : Math.min(n._stop, at);
        };
        if (isBufferSource) {
            const baseStart = n.start;
            n.start = (when) => { baseStart(when); started.push(n); };
        }
        return n;
    }
    return ctx;
}

/**
 * Fire onended for every source that has finished by `time`, like a browser
 * would: a one shot buffer ends when it runs out, a looping buffer or an
 * oscillator only ends when it is stopped.
 */
function advanceTo(ctx, time) {
    ctx.currentTime = time;
    for (const s of started) {
        if (s._ended || s._start == null) continue;
        const duration = s.buffer ? s.buffer.duration : Infinity;
        const naturalEnd = s.loop ? Infinity : s._start + duration;
        const end = s._stop == null ? naturalEnd : Math.min(naturalEnd, s._stop);
        if (end <= time) {
            s._ended = true;
            if (s.buffer && !s.buffer._released) { s.buffer._released = true; stats.bufferBytes -= s.buffer._bytes; }
            s.buffer = null;
            if (s.onended) s.onended();
            stats.liveSources--;
        }
    }
}

/* ---------------------------------------------------------------------- */

const ctx = makeContext();
const picoAudio = new PicoAudio({
    audioContext: ctx,
    soundQuality: MODE === 'sf2' ? 4 : QUALITY,
    sf2Engine: process.env.SF2_ENGINE || 'dsp',
    isReverb: true,
    isChorus: true,
});
picoAudio.states.startTime = 0;
picoAudio.baseLatency = 0;

if (MODE === 'sf2') {
    const fontBuf = fs.readFileSync(fontPath);
    if (!picoAudio.loadSF2(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength))) {
        throw new Error('cannot load soundfont');
    }
}

const bytes = new Uint8Array(fs.readFileSync(songPath));
const parsed = picoAudio.parseSMF(bytes);
if (typeof parsed === 'string') throw new Error(parsed);
const song = parsed;

const notes = [];
for (let ch = 0; ch < 16; ch++) for (const n of song.channels[ch].notes) notes.push({ ...n, channel: ch });
notes.sort((a, b) => a.startTime - b.startTime);

const songLength = Math.max(song.lastNoteOffTime || 0, song.lastEventTime || 0);
const until = Math.min(minutes * 60, songLength);
const STEP = 0.25;
let next = 0;
const live = [];
let peakHeap = 0;
const mb = (n) => (n / 1048576).toFixed(1);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`${songPath.split(/[\\/]/).pop()} | ${notes.length} notes | mode=${MODE}${MODE === 'note' ? ` quality=${QUALITY}` : ''} | ${until.toFixed(0)}s\n`);
console.log('   t  | live notes | live src | live nodes | buf MB | peak buf | heap MB');

for (let t = 0; t < until; t += STEP) {
    advanceTo(ctx, t);

    while (next < notes.length && notes[next].startTime <= t + 0.3) {
        const note = notes[next++];
        const stopTime = note.stopTime != null ? note.stopTime : songLength;
        if (stopTime <= t) continue;
        const option = { ...note, startTime: note.startTime, stopTime };
        currentNote = note;
        const stopFunc = (MODE === 'perc' || note.channel === 9)
            ? (MODE === 'sf2' ? picoAudio.createNote(option) : picoAudio.createPercussionNote(option))
            : picoAudio.createNote(option);
        currentNote = null;
        if (stopFunc) live.push({ note, stopFunc, stopTime });
    }
    for (let i = live.length - 1; i >= 0; i--) {
        if (t > live[i].stopTime + 0.01) live.splice(i, 1);
    }

    if (Math.abs(t % 30) < STEP / 2) {
        global.gc && global.gc();
        const heap = process.memoryUsage().heapUsed;
        peakHeap = Math.max(peakHeap, heap);
        console.log(`${String(t.toFixed(0)).padStart(4)}s | ${String(live.length).padStart(10)} | ${String(stats.liveSources).padStart(8)} | `
            + `${String(stats.liveNodes).padStart(10)} | ${mb(stats.bufferBytes).padStart(6)} | ${mb(stats.peakBufferBytes).padStart(8)} | ${mb(heap).padStart(7)}`);
    }
}

console.log(`\nend: live nodes ${stats.liveNodes} (created ${stats.createdNodes}), live sources ${stats.liveSources} (created ${stats.createdSources})`);

console.log('\ndraining (no new notes)...');
for (let i = 0; i < 90; i++) {
    await sleep(30);
    advanceTo(ctx, ctx.currentTime + 1);
}
global.gc && global.gc();
console.log(`after drain: live nodes ${stats.liveNodes}, live sources ${stats.liveSources}, `
    + `buffers held ${mb(stats.bufferBytes)} MB, heap ${mb(process.memoryUsage().heapUsed)} MB`);
const kinds = Object.keys(stats.createdByKind).sort();
console.log('live nodes by kind: '
    + kinds.map((k) => `${k} ${stats.liveByKind[k] || 0}/${stats.createdByKind[k]}`).join(', '));

const stuck = allSources.filter((s) => !s._disc && s._note);
console.log(`\nsources never disconnected: ${stuck.length}/${allSources.length}`);
const groups = {};
for (const s of stuck) {
    const n = s._note;
    const key = `ch${n.channel} inst${n.instrument} loop=${s.loop ? 'Y' : 'N'} started=${s._start != null ? 'Y' : 'N'}`
        + ` stop=${n.stopTime != null ? 'set' : 'null'} notes=`;
    groups[key] = (groups[key] || 0) + 1;
}
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${v.toString().padStart(4)}  ${k}`);
}
if (stuck.length) {
    const sample = stuck.slice(0, 3).map((s) => ({
        channel: s._note.channel, instrument: s._note.instrument, pitch: s._note.pitch,
        velocity: +s._note.velocity.toFixed(3), start: +s._note.startTime.toFixed(2),
        stop: s._note.stopTime != null ? +s._note.stopTime.toFixed(2) : null,
        loop: s.loop, startCalled: s._start,
    }));
    console.log('   examples:', JSON.stringify(sample));
}

// Which notes do the leftover nodes belong to?
const leftovers = [];
for (const kind of Object.keys(stats.liveByKind)) {
    if (!stats.liveByKind[kind]) continue;
}
for (const node of allNodes) {
    if (!node._disc && node._note) leftovers.push(node);
}
console.log(`\nleftover nodes tied to a note: ${leftovers.length}`);
const byNote = new Map();
for (const node of leftovers) {
    const n = node._note;
    if (!byNote.has(n)) byNote.set(n, []);
    byNote.get(n).push(node.kind);
}
console.log(`notes with leftover nodes: ${byNote.size}`);
let shown = 0;
for (const [n, kinds] of byNote) {
    if (shown++ >= 5) break;
    console.log(`   ch${n.channel} inst${n.instrument} pitch${n.pitch} vel${n.velocity.toFixed(2)}`
        + ` start${n.startTime.toFixed(2)} stop${n.stopTime != null ? n.stopTime.toFixed(2) : 'null'}`
        + ` -> ${kinds.join(',')}`);
}
