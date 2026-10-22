// Verify every PicoAudio build variant: which engines it contains, that the
// ones it keeps still play, and that the excluded ones are really gone from
// the bundle (dead code, not just disabled at runtime).
//
// Usage:
//   npm run --prefix lib/PicoAudio build      # build all variants first
//   node scripts/verify-picoaudio-builds.mjs
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST = "lib/PicoAudio/dist/nodejs";
const BROWSER_DIST = "lib/PicoAudio/dist/browser";
const SF2 = "resources/assets/Neo1MGM.sf2";
const RATE = 44100;

const waModule = process.env.WA_MODULE
    || path.join(process.env.TEMP || "/tmp", "wa-test", "node_modules", "node-web-audio-api", "index.js");
const wa = await import(pathToFileURL(waModule).href);
globalThis.window = globalThis;
window.AudioContext = wa.AudioContext;

// Marker strings that must / must not survive tree shaking.
const MARKERS = {
    synth: "createPeriodicWave",
    sf2: "sfbk",
};

const VARIANTS = [
    { name: "basic", file: "picoaudio.basic.mjs", wave: false, sf2: false },
    { name: "wave", file: "picoaudio.wave.mjs", wave: true, sf2: false },
    { name: "sf2", file: "picoaudio.sf2.mjs", wave: false, sf2: true },
    { name: "full", file: "picoaudio.mjs", wave: true, sf2: true },
];

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };
const realLog = console.log;
const realWarn = console.warn;
const quiet = (fn) => {
    console.log = () => {};
    console.warn = () => {};
    try { return fn(); } finally { console.log = realLog; console.warn = realWarn; }
};

// One MIDI note the way the SMF parser hands it to the engine.
const noteOption = (pitch, instrument = 0, velocity = 100) => ({
    start: 0, stop: 480, startTime: 0, stopTime: 1,
    pitch, pitchBend: [{ timing: 0, time: 0, value: 0 }],
    pan: [{ timing: 0, time: 0, value: 64 }],
    expression: [{ timing: 0, time: 0, value: 127 }],
    velocity: velocity / 127,
    modulation: [{ timing: 0, time: 0, value: 0 }],
    reverb: [], chorus: [],
    instrument, bank: 0, channel: 0, nextSameNoteOnInterval: -1, drumStopTime: 2,
});

async function render(PicoAudio, { quality, pitch = 60, instrument = 0, percussion = false, prepare }) {
    const context = new wa.OfflineAudioContext(2, RATE, RATE);
    const player = quiet(() => new PicoAudio({
        audioContext: context, soundQuality: quality, isReverb: false, isChorus: false,
    }));
    if (prepare) prepare(player, context);
    const option = noteOption(pitch, instrument);
    if (percussion) option.channel = 9;
    quiet(() => (percussion ? player.createPercussionNote(option) : player.createNote(option)));
    const buffer = await context.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    let peak = 0;
    for (let i = 0; i < left.length; i++) {
        mono[i] = (left[i] + right[i]) * 0.5;
        peak = Math.max(peak, Math.abs(mono[i]));
    }
    return { peak, mono, settings: player.settings, player };
}

/** Correlation of two renders: 1.0 = the same engine produced them. */
function correlation(a, b) {
    const n = Math.min(a.length, b.length);
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let i = 0; i < n; i++) {
        sa += a[i]; sb += b[i];
        saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i];
    }
    const ma = sa / n, mb = sb / n;
    return (sab / n - ma * mb) / Math.sqrt((saa / n - ma * ma) * (sbb / n - mb * mb));
}

// ---------------------------------------------------------------- fixtures --
const sf2Buffer = fs.readFileSync(SF2);
const sf2ArrayBuffer = sf2Buffer.buffer.slice(sf2Buffer.byteOffset, sf2Buffer.byteOffset + sf2Buffer.byteLength);

console.log("variant            file                              KiB  wave  sf2   | behaviour");
for (const variant of VARIANTS) {
    const file = path.join(DIST, variant.file);
    const code = fs.readFileSync(file, "utf8");
    const kib = fs.statSync(file).size / 1024;
    const PicoAudio = (await import(pathToFileURL(path.resolve(file)).href)).default;

    // 1. the bundle advertises the features it was built with
    const features = PicoAudio.features || {};
    for (const key of ["wave", "sf2"]) {
        if (!!features[key] !== variant[key]) {
            fail(`${variant.name}: features.${key} is ${features[key]}, expected ${variant[key]}`);
        }
    }

    // 2. dead code is really gone from the bundle
    if (code.includes(MARKERS.synth) !== variant.wave) {
        fail(`${variant.name}: synth code ${variant.wave ? "missing" : "still present"}`);
    }
    if (code.includes(MARKERS.sf2) !== variant.sf2) {
        fail(`${variant.name}: SF2 code ${variant.sf2 ? "missing" : "still present"}`);
    }

    const results = [];

    // 3. basic waveform mode works everywhere, percussion is upstream behaviour
    const basic = await render(PicoAudio, { quality: 0, instrument: 0 });
    if (!(basic.peak > 1e-4)) fail(`${variant.name}: quality 0 rendered silence`);
    // (The basic kit starts a source without a buffer, which only node-web-audio-api
    // complains about - Chrome plays silence there and the tone still sounds.)
    const drum = await render(PicoAudio, { quality: 0, pitch: 36, percussion: true });
    if (!(drum.peak > 1e-4)) fail(`${variant.name}: percussion rendered silence`);
    results.push(`q0 ${basic.peak.toFixed(3)}`);
    results.push(`q0-drum ${drum.peak.toFixed(3)}`);

    // 4. synth instrument mode: quality 1 plays the hand-programmed patches
    const sameAsBasic = (r) => correlation(basic.mono, r.mono);
    if (variant.wave) {
        const synth = await render(PicoAudio, { quality: 1, instrument: 0 });
        if (!(synth.peak > 1e-4)) fail(`${variant.name}: quality 1 synth patch rendered silence`);
        if (sameAsBasic(synth) > 0.9) fail(`${variant.name}: quality 1 synth patch did not leave the basic engine`);
        results.push(`q1 synth ${synth.peak.toFixed(3)}`);
    } else {
        // A build without the engine keeps soundQuality out of 1 and falls back.
        const clamped = await render(PicoAudio, { quality: 1, instrument: 0 });
        if (clamped.settings.soundQuality !== 0) fail(`${variant.name}: soundQuality 1 was not clamped to 0`);
        if (sameAsBasic(clamped) < 0.99) fail(`${variant.name}: clamped quality 1 did not play basic`);
        results.push(`q1 -> q0 ${clamped.peak.toFixed(3)}`);
    }

    // 5. soundfont mode: plays once a font is loaded, otherwise falls back
    if (variant.sf2) {
        const noFont = await render(PicoAudio, { quality: 4, instrument: 0 });
        if (sameAsBasic(noFont) < 0.99) fail(`${variant.name}: quality 4 without a font did not fall back to basic`);
        results.push(`q4 -> q0 ${noFont.peak.toFixed(3)}`);

        const load = (player) => { quiet(() => player.loadSF2(sf2ArrayBuffer)); };
        const sf2 = await render(PicoAudio, {
            quality: 4, instrument: 0,
            prepare: load,
        });
        if (!sf2.player.isSF2Loaded()) fail(`${variant.name}: loadSF2() did not load the font`);
        if (!(sf2.peak > 1e-4)) fail(`${variant.name}: quality 4 rendered silence`);
        if (correlation(basic.mono, sf2.mono) > 0.9) fail(`${variant.name}: quality 4 did not use the soundfont`);
        results.push(`q4 font ${sf2.peak.toFixed(3)}`);

        // soundQuality 3 was the sample bank; it has to behave exactly like 4.
        const legacy = await render(PicoAudio, { quality: 3, instrument: 0, prepare: load });
        if (legacy.settings.soundQuality !== 4) fail(`${variant.name}: soundQuality 3 was not remapped to 4`);
        if (correlation(sf2.mono, legacy.mono) < 0.999) fail(`${variant.name}: soundQuality 3 does not match 4`);
        results.push("q3 == q4");
    } else {
        const unsupported = await render(PicoAudio, {
            quality: 4, instrument: 0,
            prepare: (player) => {
                if (player.loadSF2(sf2ArrayBuffer) !== false) fail(`${variant.name}: loadSF2() did not report "unsupported"`);
                if (player.isSF2Loaded() !== false) fail(`${variant.name}: isSF2Loaded() is not false`);
            },
        });
        if (sameAsBasic(unsupported) < 0.99) fail(`${variant.name}: quality 4 without the engine did not fall back to basic`);
        results.push(`q4 unsupported -> q${unsupported.settings.soundQuality}`);
    }

    console.log(`${variant.name.padEnd(19)}${variant.file.padEnd(34)}${kib.toFixed(1).padStart(6)}`
        + `  ${String(variant.wave).padEnd(6)}${String(variant.sf2).padEnd(5)}| `
        + results.join(", "));
}

// --------------------------------------------------------- browser bundles --
for (const variant of VARIANTS) {
    const suffix = variant.name === "full" ? "" : `.${variant.name}`;
    for (const file of [`PicoAudio${suffix}.js`, `PicoAudio${suffix}.min.js`]) {
        const code = fs.readFileSync(path.join(BROWSER_DIST, file), "utf8");
        try {
            new Function(code);   // parse only, the IIFE needs a browser to run
        } catch (e) {
            fail(`${file} does not parse: ${e.message}`);
        }
    }
}

console.log(failures === 0 ? "ALL BUILD VARIANTS OK" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
