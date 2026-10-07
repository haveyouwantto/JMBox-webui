/**
 * Export the PicoAudio percussion kit (soundQuality 1) as real one-shot
 * samples, ready to be packed into bank 128 of the periodic wave soundfont.
 *
 * Unlike the melodic instruments the drums are not periodic, so they cannot
 * be stored as a single cycle: each key is rendered offline through the actual
 * percussion synth (create-percussion-note.js) and trimmed to its tail.
 *
 * The kit is rendered at full velocity and the *relative* balance between the
 * drums is kept (one common scale factor for all of them), so the soundfont
 * only has to apply its own velocity curve.
 *
 * Output (default test_samples/periodicwave/drums):
 *   wav/d036_Bass_Drum_1.wav   mono one shot, no loop
 *   manifest.tsv               same columns as the melodic manifest, with
 *                              bank = 128 and loopMode = 0
 *
 * Requires the built PicoAudio bundle (npm run picoaudio) and
 * node-web-audio-api (OfflineAudioContext in Node).
 *
 * Usage:
 *   node scripts/export-periodicwave-drums.mjs [--out=DIR] [--secs=3]
 *        [--velocity=127] [--tail-db=70] [--rate=44100] [--stereo] [--quiet]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ------------------------------------------------------------------ args -- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return def;
    const eq = hit.indexOf("=");
    return eq < 0 ? true : hit.slice(eq + 1);
};
const outDir = String(arg("out", "test_samples/periodicwave/drums"));
const secs = Number(arg("secs", 3));
const midiVelocity = Number(arg("velocity", 127));
const tailDb = Number(arg("tail-db", 70));
const rate = Number(arg("rate", 44100));
const stereo = argv.includes("--stereo");
const useCompressor = !argv.includes("--no-compressor");
const quiet = argv.includes("--quiet");
const log = (...a) => { if (!quiet) console.log(...a); };

const waModule = process.env.WA_MODULE
    || path.join(process.env.TEMP || "/tmp", "wa-test", "node_modules", "node-web-audio-api", "index.js");
let wa;
try {
    wa = await import(pathToFileURL(waModule).href);
} catch (e) {
    console.error(`cannot load node-web-audio-api from ${waModule}`);
    console.error("install it with:  npm i node-web-audio-api");
    process.exit(1);
}

/* ------------------------------------------------------------ GM drum map -- */
const KIT = new Map([
    [27, "High Q"], [28, "Slap"], [29, "Scratch Push"], [30, "Scratch Pull"],
    [31, "Sticks"], [32, "Square Click"], [33, "Metronome Click"], [34, "Metronome Bell"],
    [35, "Acoustic Bass Drum"], [36, "Bass Drum 1"], [37, "Side Stick"], [38, "Acoustic Snare"],
    [39, "Hand Clap"], [40, "Electric Snare"], [41, "Low Floor Tom"], [42, "Closed Hi-Hat"],
    [43, "High Floor Tom"], [44, "Pedal Hi-Hat"], [45, "Low Tom"], [46, "Open Hi-Hat"],
    [47, "Low-Mid Tom"], [48, "Hi-Mid Tom"], [49, "Crash Cymbal 1"], [50, "High Tom"],
    [51, "Ride Cymbal 1"], [52, "Chinese Cymbal"], [53, "Ride Bell"], [54, "Tambourine"],
    [55, "Splash Cymbal"], [56, "Cowbell"], [57, "Crash Cymbal 2"], [58, "Vibraslap"],
    [59, "Ride Cymbal 2"], [60, "Hi Bongo"], [61, "Low Bongo"], [62, "Mute Hi Conga"],
    [63, "Open Hi Conga"], [64, "Low Conga"], [65, "High Timbale"], [66, "Low Timbale"],
    [67, "High Agogo"], [68, "Low Agogo"], [69, "Cabasa"], [70, "Maracas"],
    [71, "Short Whistle"], [72, "Long Whistle"], [73, "Short Guiro"], [74, "Long Guiro"],
    [75, "Claves"], [76, "Hi Wood Block"], [77, "Low Wood Block"], [78, "Mute Cuica"],
    [79, "Open Cuica"], [80, "Mute Triangle"], [81, "Open Triangle"], [82, "Shaker"],
    [83, "Jingle Bell"], [84, "Belltree"], [85, "Castanets"], [86, "Mute Surdo"],
    [87, "Open Surdo"],
]);

/* --------------------------------------------------- offline drum renders -- */
globalThis.window = globalThis;
window.AudioContext = wa.AudioContext;

// The bundle prints the parsed wave table while loading; keep the output clean.
const realLog = console.log;
console.log = () => {};
let PicoAudio;
try {
    PicoAudio = (await import("../lib/PicoAudio/dist/nodejs/picoaudio.mjs")).default;
} finally {
    console.log = realLog;
}

const shared = { audioContext: new wa.OfflineAudioContext(2, rate, rate) };
const options = {
    ...shared,
    soundQuality: 1,
    isReverb: false,
    isChorus: false,
    generateVolume: 1,
    masterVolume: 1,
    instrumentAttenuation: 1,
};
console.log = () => {};
const template = new PicoAudio(options);        // creates the noise buffers once
console.log = realLog;

// The engine routes soundQuality 1 to the basic engine while no wave table is
// loaded, so load the built in one first: the kit that is exported here has to
// be the one the app plays (wavetable mode).
const tableSource = fs.readFileSync(
    path.join("lib", "PicoAudio", "src", "player", "sound-source", "default-wave.js"), "utf8");
const defaultTable = Buffer.from(tableSource.match(/'([^']+)'/)[1], "base64");
const defaultTableBuffer = defaultTable.buffer.slice(
    defaultTable.byteOffset, defaultTable.byteOffset + defaultTable.byteLength);

async function renderDrum(key) {
    const context = new wa.OfflineAudioContext(2, Math.round(rate * secs), rate);
    console.log = () => {};
    const player = new PicoAudio({ ...options, audioContext: context, picoAudio: template });
    console.log = realLog;
    player.loadWaves(defaultTableBuffer.slice(0));
    // The engine's master chain ends in a dynamics compressor. Keeping it
    // bakes what the kit actually sounds like; without it the raw drum sums
    // peak around +9 dBFS and the kit balance is completely different.
    if (!useCompressor) {
        player.highFilter.disconnect();
        player.highFilter.connect(context.destination);
    }

    player.createPercussionNote({
        pitch: key,
        velocity: midiVelocity / 127,
        startTime: 0,
        stopTime: secs - 0.2,
        channel: 9,
        expression: [{ timing: 0, time: 0, value: 127 }],
        nextSameNoteOnInterval: -1,
        drumStopTime: secs,
    });
    const buffer = await context.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) * 0.5;
    return mono;
}

const rendered = [];
for (const [key, name] of KIT) {
    const mono = await renderDrum(key);
    let peak = 0;
    for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
    rendered.push({ key, name, mono, peak });
    log(`  key ${key} ${name.padEnd(18)} peak ${peak.toExponential(2)}`);
}

const globalPeak = rendered.reduce((m, r) => Math.max(m, r.peak), 0);
if (!(globalPeak > 0)) {
    console.error("no audio rendered - is the PicoAudio bundle up to date?");
    process.exit(1);
}
const scale = 0.98 / globalPeak;
const threshold = globalPeak * Math.pow(10, -tailDb / 20);

/* --------------------------------------------------------------- helpers -- */
/** Trim to the last sample above the tail threshold, plus a 3 ms fade out. */
function trim(mono) {
    let last = mono.length - 1;
    while (last > 0 && Math.abs(mono[last]) < threshold) last--;
    last = Math.min(mono.length - 1, last + Math.round(0.02 * rate));
    // The engine's compressor has a look ahead delay; drop it so a hit lands
    // on the beat, keeping 1 ms of pre-roll for soft onsets.
    let first = 0;
    while (first < last && Math.abs(mono[first]) < threshold) first++;
    first = Math.max(0, first - Math.round(0.001 * rate));
    const frames = new Int16Array(last - first + 1);
    const fade = Math.round(0.003 * rate);
    for (let i = first; i <= last; i++) {
        let v = mono[i] * scale;
        if (i > last - fade) v *= (last - i) / fade;
        frames[i - first] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
    }
    return frames;
}

/** 16 bit WAV holding a one shot (smpl chunk with zero loops). */
function writeWav(file, frames, sampleRate, rootKey) {
    const dataBytes = frames.length * 2;
    const smplSize = 36;
    const buf = Buffer.alloc(44 + smplSize + 8 + dataBytes);
    let p = 0;
    const str = (s) => { buf.write(s, p, "latin1"); p += s.length; };
    const u32 = (v) => { buf.writeUInt32LE(v >>> 0, p); p += 4; };
    const u16 = (v) => { buf.writeUInt16LE(v & 0xffff, p); p += 2; };

    str("RIFF"); u32(4 + 24 + (8 + smplSize) + (8 + dataBytes)); str("WAVE");
    str("fmt "); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16);
    str("smpl"); u32(smplSize);
    u32(0); u32(0); u32(Math.round(1e9 / sampleRate)); u32(rootKey); u32(0); u32(0); u32(0);
    u32(0); u32(0);                       // no loop: one shot
    str("data"); u32(dataBytes);
    for (let i = 0; i < frames.length; i++) { buf.writeInt16LE(frames[i], p); p += 2; }
    fs.writeFileSync(file, buf);
}

/* ----------------------------------------------------------------- write -- */
fs.mkdirSync(path.join(outDir, "wav"), { recursive: true });
const columns = [
    "file", "bank", "program", "name", "octave", "lokey", "hikey", "rootKey", "sampleRate",
    "loopStart", "loopEnd", "loopMode", "pitchCorrection",
    "attackVolEnv", "decayVolEnv", "sustainVolEnv", "releaseVolEnv",
    "vibLfoToPitch", "freqVibLFO",
    "initialFilterFc", "modEnvToFilterFc", "decayModEnv", "sustainModEnv", "releaseModEnv",
];
const rows = [columns.join("\t")];
let framesTotal = 0;
let bytes = 0;

for (const drum of rendered) {
    const frames = trim(drum.mono);
    const safe = drum.name.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 20);
    const file = `d${String(drum.key).padStart(3, "0")}_${safe}.wav`;
    const target = path.join(outDir, "wav", file);
    writeWav(target, frames, rate, drum.key);
    bytes += fs.statSync(target).size;
    framesTotal += frames.length;

    rows.push([
        path.posix.join("wav", file), 128, 0, drum.name, 0, drum.key, drum.key, drum.key,
        rate, 0, 0, 0, 0,                     // no loop, exact pitch
        -12000, -12000, 0, 12000,             // sample carries its own envelope
        0, -536,
        -1, 0, -1, -1, -1,
    ].join("\t"));
    log(`  wrote ${file}  ${(frames.length / rate * 1000).toFixed(0)} ms`);
}

fs.writeFileSync(path.join(outDir, "manifest.tsv"), rows.join("\n") + "\n");
log(`wrote ${rendered.length} drum samples to ${outDir}`);
log(`  wav bytes : ${(bytes / 1024).toFixed(1)} KiB, ${(framesTotal / rate).toFixed(1)} s of audio`);
log(`  kit scale : ${scale.toFixed(3)} (loudest drum peaks at 0.98)`);
