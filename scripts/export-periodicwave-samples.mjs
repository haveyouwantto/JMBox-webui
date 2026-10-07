/**
 * Export the PicoAudio "periodic wave" instrument set (soundQuality 1) as
 * single cycle wavetables + a manifest, ready to be packed into an SF2.
 *
 * The wavetable mode synthesises every GM program from a small harmonic
 * amplitude table (lib/PicoAudio/src/player/sound-source/default-wave.js):
 * per program there are 5 octave variants, each holding 12..48 harmonic
 * amplitudes. getWaveTable() turns that into one 2048 sample long cycle with
 * an IFFT and random phases, then loops it with playbackRate = f*N/rate.
 *
 * A single cycle loops identically at any pitch, so this script emits the
 * same waveform with the shortest table that still carries every harmonic
 * (N = 2 * harmonics + 2) instead of the engine's fixed 2048 points. That is
 * what makes the resulting SF2 small; the spectra are the same.
 *
 * Output (default test_samples/periodicwave):
 *   wav/p000_o2_Piano_1.wav   16 bit mono, one cycle, `smpl` loop chunk
 *   manifest.tsv              one row per sample, SF2 ready generator values
 *
 * The manifest is consumed by scripts/build-sf2-from-manifest.java, which
 * writes the actual soundfont with the JDK's own SF2 writer
 * (com.sun.media.sound.SF2Soundbank#save, Gervill's non public API).
 *
 * Usage:
 *   node scripts/export-periodicwave-samples.mjs [--out=DIR] [--seed=N]
 *        [--oversample=F] [--no-filter] [--quiet]
 */
import fs from "node:fs";
import path from "node:path";

/* ------------------------------------------------------------------ args -- */
const argv = process.argv.slice(2);
const arg = (name, def) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return def;
    const eq = hit.indexOf("=");
    return eq < 0 ? true : hit.slice(eq + 1);
};
const outDir = String(arg("out", "test_samples/periodicwave"));
const seed = Number(arg("seed", 1));
/** Sampling oversampling factor: 1 = shortest table that carries every harmonic. */
const oversample = Number(arg("oversample", 1));
const pluckFilter = !argv.includes("--no-filter");
const quiet = argv.includes("--quiet");

const SRC = "lib/PicoAudio/src/player/sound-source/default-wave.js";
const log = (...a) => { if (!quiet) console.log(...a); };

/* ------------------------------------------------- harmonic table parsing -- */
const src = fs.readFileSync(SRC, "utf8");
const b64 = src.match(/'([^']+)'/)[1];
const raw = Buffer.from(b64, "base64");
const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

/** Same dequantisation as dequantize() in periodic-wave-man.js. */
function dequantize(byte) {
    if (byte === 0) return 0;
    if (byte === 255) return 1;
    return Math.pow(10, (byte * (80 / 255) - 80) / 20);
}
/** dequantizeTime(): table value -> seconds (0..4). */
const dequantizeTime = (v) => (v / 65535) * 4;

/** parseInstruments() from periodic-wave-man.js: [octave][program]. */
const table = [];
let off = 0;
for (let octave = 0; octave < 5; octave++) {
    const row = [];
    table.push(row);
    for (let program = 0; program < 128; program++) {
        const adsr = [];
        for (let i = 0; i < 4; i++) {
            adsr.push(dequantizeTime(dv.getUint16(off, true)));
            off += 2;
        }
        const vibrato = dv.getUint8(off++) / 10;
        const len = dv.getUint8(off++);
        const data = new Float64Array(len);
        for (let i = 0; i < len; i++) data[i] = dequantize(dv.getUint8(off + i));
        off += len;
        row.push({ adsr, vibrato, data });
    }
}

/* --------------------------------------------------------- GM name tables -- */
const GM_NAMES = [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-tonk Piano",
    "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone", "Marimba", "Xylophone",
    "Tubular Bells", "Dulcimer",
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ", "Reed Organ",
    "Accordion", "Harmonica", "Tango Accordion",
    "Acoustic Guitar (nylon)", "Acoustic Guitar (steel)", "Electric Guitar (jazz)",
    "Electric Guitar (clean)", "Electric Guitar (muted)", "Overdriven Guitar",
    "Distortion Guitar", "Guitar harmonics",
    "Acoustic Bass", "Electric Bass (finger)", "Electric Bass (pick)", "Fretless Bass",
    "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    "Violin", "Viola", "Cello", "Contrabass", "Tremolo Strings", "Pizzicato Strings",
    "Orchestral Harp", "Timpani",
    "String Ensemble 1", "String Ensemble 2", "SynthStrings 1", "SynthStrings 2",
    "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit",
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet", "French Horn", "Brass Section",
    "SynthBrass 1", "SynthBrass 2",
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax", "Oboe", "English Horn",
    "Bassoon", "Clarinet",
    "Piccolo", "Flute", "Recorder", "Pan Flute", "Blown Bottle", "Shakuhachi",
    "Whistle", "Ocarina",
    "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
    "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass+lead)",
    "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
    "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
    "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
    "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
    "Sitar", "Banjo", "Shamisen", "Koto", "Kalimba", "Bagpipe", "Fiddle", "Shanai",
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock", "Taiko Drum", "Melodic Tom",
    "Synth Drum", "Reverse Cymbal",
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet", "Telephone Ring",
    "Helicopter", "Applause", "Gunshot",
];

/** quickfadeArray from periodic-wave-man.js: true = plucked decay + filter sweep. */
const PLUCK = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 1, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 0,
    0, 0, 0, 0, 0, 1, 1, 1,
    0, 0, 0, 0, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    1, 0, 1, 1, 1, 0, 0, 0,
    1, 1, 1, 1, 1, 0, 0, 0,
    1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 0, 1, 1, 0, 0, 1,
].map(Boolean);

/* --------------------------------------------------------------- helpers -- */
/**
 * Keys handled by octave variant o, i.e. findClosestNumberIndex() in the
 * engine: round((key - 45) / 12), clamped to 0 below 45 and to 4 from key 87
 * upwards (so the top variant covers everything up to 127).
 */
const keyRangeOf = (octave) => {
    if (octave === 0) return [0, 50];      // everything at or below the first base note
    if (octave === 4) return [87, 127];    // everything above the top base note
    return [45 + 12 * octave - 6, 45 + 12 * octave + 5];
};
/** Base note of an octave variant (used for the pluck decay / filter maths). */
const baseKeyOf = (octave) => 45 + 12 * octave;
const freqOf = (key) => 440 * Math.pow(2, (key - 69) / 12);
/** timecents for a time in seconds, clamped to what the SF2 generators allow. */
const secsToTimecents = (secs, min = 0.001, max = 8000) => {
    const t = Math.min(Math.max(secs, min), Math.pow(2, max / 1200));
    return Math.round(1200 * Math.log2(t));
};
const hzToAbsCents = (hz) => 1200 * Math.log2(hz / 8.176);
/** Root notes whose frequency is an exact integer number of Hz. */
const ROOT_CANDIDATES = [45, 57, 69, 81, 93]; // 110, 220, 440, 880, 1760 Hz

/** Mulberry32, so the random phases are reproducible across runs. */
function prng(s) {
    let a = s >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** SBR extension of createWave(): copy the harmonics with a triangle rolloff. */
function extend(data) {
    const ext = Array.from(data);
    const len = data.length;
    const last = len > 0 ? data[len - 1] : 0;
    const first = len > 0 ? data[0] : 1;
    const sbrScale = first > 0 ? Math.min(1, last / first) : 0;
    for (let i = 0; i < len; i++) ext.push(data[i] * sbrScale * (1 - i / len));
    return ext;
}

/**
 * One cycle of the wavetable: x[n] = sum_k A_k * cos(2*pi*k*n/N - phase_k),
 * peak normalised to 1 (exactly what createPeriodicWave + getWaveTable do),
 * plus a guard frame equal to frame 0 so players never read past the loop.
 */
function renderCycle(amps, rand) {
    const H = amps.length;
    const N = Math.max(4, Math.round((2 * H + 2) * oversample));
    const phases = new Float64Array(H + 1);
    for (let k = 1; k <= H; k++) phases[k] = rand() * 2 * Math.PI - Math.PI;

    const x = new Float64Array(N);
    for (let k = 1; k <= H; k++) {
        const a = amps[k - 1];
        if (a === 0) continue;
        const step = (2 * Math.PI * k) / N;
        const c = Math.cos(step), s = Math.sin(step);
        let cr = Math.cos(-phases[k]), sr = Math.sin(-phases[k]);
        for (let n = 0; n < N; n++) {
            x[n] += a * cr;
            const nr = cr * c - sr * s;
            sr = cr * s + sr * c;
            cr = nr;
        }
    }
    let peak = 0;
    for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(x[n]));
    if (peak > 0) for (let n = 0; n < N; n++) x[n] /= peak;

    const frames = new Int16Array(N + 1);
    for (let n = 0; n < N; n++) frames[n] = Math.round(x[n] * 32767);
    frames[N] = frames[0];
    return { frames, N };
}

/** 16 bit mono WAV with a `smpl` chunk pointing at the one cycle loop. */
function writeWav(file, frames, sampleRate, rootKey) {
    const dataBytes = frames.length * 2;
    const smplSize = 36 + 24;
    const buf = Buffer.alloc(44 + smplSize + 8 + dataBytes);
    let p = 0;
    const str = (s) => { buf.write(s, p, "latin1"); p += s.length; };
    const u32 = (v) => { buf.writeUInt32LE(v >>> 0, p); p += 4; };
    const u16 = (v) => { buf.writeUInt16LE(v & 0xffff, p); p += 2; };

    str("RIFF"); u32(4 + (8 + 16) + (8 + smplSize) + (8 + dataBytes)); str("WAVE");
    str("fmt "); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16);
    str("smpl"); u32(smplSize);
    u32(0); u32(0);                       // manufacturer, product
    u32(Math.round(1e9 / sampleRate));    // sample period (ns)
    u32(rootKey); u32(0); u32(0); u32(0);
    u32(1); u32(0);                       // one loop, no extra sampler data
    u32(0); u32(0);                       // cue point, forward loop
    const loopEnd = frames.length;        // exclusive: samples 0..N-1
    u32(0); u32(loopEnd); u32(0); u32(0);
    str("data"); u32(dataBytes);
    for (let i = 0; i < frames.length; i++) { buf.writeInt16LE(frames[i], p); p += 2; }

    fs.writeFileSync(file, buf);
    return buf.length;
}

/* ------------------------------------------------------------ SF2 mapping -- */
/**
 * Turn one table entry into SF2 generator values.
 *
 * The engine drives the gain with setTargetAtTime, i.e. an exponential with
 * time constant tau, while TinySoundFont's amp envelope decays with
 * exp(-9.226 * t / decaySecs) => tau = decaySecs / 9.226. All the mappings
 * below keep the initial slope (what you hear) and the sustain level, they do
 * not try to match the asymptotic tail.
 */
function envelopeOf(entry, octave, pluck) {
    const [attack, decay, sustain, release] = entry.adsr;
    const attackSecs = Math.max(attack, 0.001);

    // Plucked programs ignore "sustain" and decay to silence with a pitch
    // dependent time constant (create-note.js, quickfadeArray branch).
    const baseKey = baseKeyOf(octave);
    const decaySecs = pluck
        ? Math.max(decay * 1.7 * Math.pow(2, (60 - baseKey) / 18), 0.5)
        : decay;
    const sustainLevel = pluck ? 0 : Math.min(Math.max(sustain, 0), 1);

    // tau (engine) -> decay generator: taper = tau / (1 - sustain) so the
    // starting slope matches, then decay = 9.226 * taper.
    let decayTc = -12000;
    if (decaySecs > 0) {
        const tau = decaySecs / 2 / Math.max(1 - sustainLevel, 1e-3);
        decayTc = secsToTimecents(9.226 * tau);
    }
    const sustainCb = sustainLevel <= 0
        ? 1440
        : Math.min(1440, Math.max(0, Math.round(-200 * Math.log10(sustainLevel))));
    const releaseSecs = Math.min(Math.max(release, 0.001), 0.25);
    const releaseTc = secsToTimecents(3.075 * releaseSecs);

    return {
        attackTc: secsToTimecents(attackSecs),
        decayTc,
        sustainCb,
        releaseTc,
        // 6 Hz vibrato LFO, depth straight from the table (cents on detune).
        vibToPitch: Math.round(entry.vibrato),
        vibFreqTc: Math.round(hzToAbsCents(6)),
        vibrato: entry.vibrato,
    };
}

/** Pluck filter sweep approximation (see create-note.js isPluck branch). */
function filterOf(entry, octave) {
    if (!pluckFilter) return null;
    const baseKey = baseKeyOf(octave);
    const pitchFreq = freqOf(baseKey);
    const velocity = 0.7;                      // assumed CC7-less velocity
    const cutoffFreq = 492.35 * Math.exp(2.5 * velocity);
    const nyquist = 22050;
    const pitchComp = Math.pow(2, (60 - baseKey) / 36);
    const filterStart = Math.min(Math.max(pitchFreq * 4 * pitchComp, cutoffFreq * 1.5), nyquist);
    const filterTarget = Math.min(Math.max(pitchFreq * 1.2, cutoffFreq * 0.05), nyquist);
    const decaySecs = Math.max(entry.adsr[1] * 1.7 * Math.pow(2, (60 - baseKey) / 18), 0.5);
    return {
        initialFc: Math.round(Math.min(13500, Math.max(1500, hzToAbsCents(filterTarget)))),
        modEnvToFc: Math.round(hzToAbsCents(filterStart) - hzToAbsCents(filterTarget)),
        // modEnv decays linearly (not exponentially) in TinySoundFont.
        decayModEnvTc: secsToTimecents(decaySecs / 2),
        sustainModEnv: 1000,                   // -> modEnv level 0, i.e. target cutoff
        releaseModEnvTc: secsToTimecents(Math.min(Math.max(entry.adsr[3], 0.001), 0.25)),
    };
}

/* -------------------------------------------------------------- generate -- */
fs.mkdirSync(path.join(outDir, "wav"), { recursive: true });

const columns = [
    "file", "bank", "program", "name", "octave", "lokey", "hikey", "rootKey", "sampleRate",
    "loopStart", "loopEnd", "loopMode", "pitchCorrection",
    "attackVolEnv", "decayVolEnv", "sustainVolEnv", "releaseVolEnv",
    "vibLfoToPitch", "freqVibLFO",
    "initialFilterFc", "modEnvToFilterFc", "decayModEnv", "sustainModEnv", "releaseModEnv",
];
const rows = [columns.join("\t")];
let bytes = 0;
let framesTotal = 0;
const sizeHistogram = new Map();

for (let program = 0; program < 128; program++) {
    const pluck = PLUCK[program];
    for (let octave = 0; octave < 5; octave++) {
        const entry = table[octave][program];
        const amps = extend(entry.data);
        const rand = prng(seed * 1000003 + program * 5 + octave);
        const { frames, N } = renderCycle(amps, rand);

        // Root note with the highest exact integer frequency <= 44.1 kHz.
        let rootKey = ROOT_CANDIDATES[0];
        for (const key of ROOT_CANDIDATES) if (freqOf(key) * N <= 44100) rootKey = key;
        const sampleRate = Math.round(freqOf(rootKey) * N);

        const [lokey, hikey] = keyRangeOf(octave);
        const env = envelopeOf(entry, octave, pluck);
        const flt = pluck ? filterOf(entry, octave) : null;
        const safeName = GM_NAMES[program].replace(/[^A-Za-z0-9]+/g, "_").slice(0, 20);
        const file = `p${String(program).padStart(3, "0")}_o${octave}_${safeName}.wav`;
        const wavPath = path.join(outDir, "wav", file);
        const wavBytes = writeWav(wavPath, frames, sampleRate, rootKey);

        bytes += wavBytes;
        framesTotal += frames.length;
        sizeHistogram.set(N, (sizeHistogram.get(N) || 0) + 1);

        rows.push([
            path.posix.join("wav", file), 0, program, GM_NAMES[program], octave, lokey, hikey,
            rootKey, sampleRate, 0, N, 1, 0,
            env.attackTc, env.decayTc, env.sustainCb, env.releaseTc,
            env.vibToPitch, env.vibFreqTc,
            flt ? flt.initialFc : -1, flt ? flt.modEnvToFc : 0,
            flt ? flt.decayModEnvTc : -1, flt ? flt.sustainModEnv : -1,
            flt ? flt.releaseModEnvTc : -1,
        ].join("\t"));
    }
}

fs.writeFileSync(path.join(outDir, "manifest.tsv"), rows.join("\n") + "\n");

fs.writeFileSync(path.join(outDir, "README.md"), `# PicoAudio periodic wave wavetables

One 16 bit mono WAV per GM program and octave variant, each holding exactly one
cycle of the waveform the "periodic wave" instrument mode (soundQuality 1)
plays, plus the guard frame that makes the loop seamless.

The percussion kit cannot be stored that way (drum hits are not periodic), so
it lives next to this directory in \`drums/\`: 61 one shot samples rendered
through the engine's own percussion synth, mapped to bank 128 of the soundfont.

\`\`\`
node scripts/export-periodicwave-samples.mjs        # melodic wavetables
node scripts/export-periodicwave-drums.mjs          # percussion one shots
java --add-exports java.desktop/com.sun.media.sound=ALL-UNNAMED \\
     scripts/BuildSf2FromManifest.java test_samples/PicoAudio-PeriodicWave.sf2 \\
     test_samples/periodicwave/manifest.tsv test_samples/periodicwave/drums/manifest.tsv
node scripts/check-periodicwave-sf2.mjs             # verify the result
\`\`\`

manifest.tsv columns (tab separated, all values are directly usable as SF2
generators):

  file, bank, program, name, octave, lokey, hikey   sample and its key range
  rootKey, sampleRate, loopStart, loopEnd     loop = [loopStart, loopEnd),
                                              sampleRate == rootKey freq * loop
  loopMode                                    1 = continuous, 0 = one shot
  pitchCorrection                             always 0 (the rate is exact)
  attackVolEnv, decayVolEnv, sustainVolEnv, releaseVolEnv   amp envelope
  vibLfoToPitch, freqVibLFO                   vibrato (depth in cents, 6 Hz)
  initialFilterFc, modEnvToFilterFc, decayModEnv, sustainModEnv, releaseModEnv
                                              -1 when the program is not
                                              plucked (no filter sweep)
`);

log(`wrote ${rows.length - 1} single cycle wavetables to ${outDir}`);
log(`  wav bytes     : ${(bytes / 1024).toFixed(1)} KiB (${framesTotal} frames)`);
log(`  cycle lengths : ${[...sizeHistogram.entries()].sort((a, b) => a[0] - b[0])
    .map(([n, c]) => `${n}x${c}`).join(", ")}`);
log("  next: java --add-exports java.desktop/com.sun.media.sound=ALL-UNNAMED"
    + ` scripts/BuildSf2FromManifest.java out.sf2 ${outDir}/manifest.tsv`
    + ` ${outDir}/drums/manifest.tsv`);
