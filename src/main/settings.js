import EventListener from "./event-listener";

// For S&L configs

/**
 * Version of the stored configuration, bumped whenever a stored value has to be
 * reinterpreted (a changed default, a renamed key).
 *
 * Stored settings cannot tell "the old default" apart from "the user picked
 * it", so a default that moves has to be migrated explicitly, once, gated on
 * the version this build wrote last time.
 *
 * 2: sf2Engine's default moved from 'webaudio' to 'worklet'.
 */
const CONFIG_VERSION = 2;

const defaultValue = {
    configVersion: CONFIG_VERSION,
    dark: 'unset',
    showInfo: true,
    webmidi: false,
    midisrc: false,
    player: "PicoAudioPlayer",
    playMode: 0,
    volume: 1,
    shuffle: false,

    soundQuality: '1',
    sf2Interpolation: "linear",   // SF2 sample interpolation: linear (TSF reference) | nearest | cubic
    sf2Quality: "high",           // SF2 sound quality preset: high (reference) | medium (no modulation) | low (no filter, nearest)
    sf2Engine: "worklet",         // SF2 synthesis: worklet (AudioWorklet, cheapest per note) | dsp (TinySoundFont port, exact, main thread) | webaudio (native nodes, kept as the last resort)
    basePitch: 440,
    maxPolyphony: -1,
    skipBeginning: false,
    skipEnding: true,
    midiLatency: 250,
    lastMidiDevice: "",
    preGain: 6,
    globalReverb: false,
    
    spanDuration: 4,
    maxNoteDuration: 30,
    language: "auto",
    noteTransparency: false,
    highlightNotes: true,
    sortFunc: "sortName",
    prefmon: false,
    fancyMode: false,
    showLyrics: true,
    lyricsEncoding: "UTF-8",
    detailedNotes: false,
    showBarLines: true,
    showInfoOverlay: true,

    // ── 渲染器模式 ──
    rendererMode: "canvas2d",  // "webgl" | "canvas2d" | "neo-cascade" | "neo-orbit" | "neo-warp" | "neo-trail"

    // ── WebGL 3D ──
    zScale: 16,
    bloomStrength: 0.72,
    bloomRadius: 0.55,
    bloomThreshold: 0,
    // 衰减 & 强度
    noteDecay: 1,
    noteBloomBase: 10,
    noteBloomIdle: 0.5,
    noteBloomMin: 1,
    playlineDecay: 2.5,
    playlineBaseEmissive: 0.25,
    playlineBoostMultiplier: 2.8,
    starDecay: 16,
    starBloomBase: 15,
    starBloomMin: 0.15,
    starBoostOnAnyNote: true,
    // 摄像机
    cameraYOffsetLandscape: 40,
    cameraYOffsetPortrait: 70,
    cameraZOffsetLandscape: 40,
    cameraZOffsetPortrait: -10,
    cameraLookAheadLandscape: 30,
    cameraLookAheadPortrait: 70,
    // 星云
    nebulaEnabled: true,
    nebulaRightX: -50,
    nebulaBaseY: 10
}

const settings = {};
const prefix = 'jmbox';

/**
 * One time reinterpretation of values written by an older build.
 *
 * Runs before the defaults are filled in, so it only sees keys that were
 * actually stored (a missing key is a fresh install and gets the new default
 * anyway).
 */
function migrateSettings(localStorage) {
    const stored = parseInt(localStorage.getItem(`${prefix}.configVersion`), 10);
    if (!(stored >= 2)) {
        // The synthesis engine default moved from Web Audio to AudioWorklet:
        // the worklet cost almost nothing of the audio thread, the DSP engine
        // is the exact reference to fall back to, Web Audio the last resort.
        if (localStorage.getItem(`${prefix}.sf2Engine`) === 'webaudio') {
            localStorage.setItem(`${prefix}.sf2Engine`, 'worklet');
        }
    }
}

/**
 * Load configurations from disk
 */
export function loadSettings() {
    const localStorage = window.localStorage;
    migrateSettings(localStorage);
    for (const key in defaultValue) {
        if (Object.hasOwnProperty.call(defaultValue, key)) {
            const element = localStorage.getItem(`${prefix}.${key}`);
            if (element == null) {
                editSetting(key, defaultValue[key]);
            } else {
                switch (typeof defaultValue[key]) {
                    case 'string':
                        editSetting(key, element)
                        break;
                    case 'number':
                        editSetting(key, parseFloat(element))
                        break;
                    case 'boolean':
                        editSetting(key, element == 'true')
                        break;
                    default:
                        editSetting(key, element)
                }
            }
        }
    }
}

/**
 * Save configurations to disk
 */
let savingSettings = false;
export function saveNow() {
    const localStorage = window.localStorage;
    for (const key in settings) {
        if (Object.hasOwnProperty.call(settings, key)) {
            const element = settings[key];
            localStorage.setItem(`${prefix}.${key}`, element);
        }
    }
    console.log("Settings saved.");

    savingSettings = false;
}

export function saveSettings() {
    if (!savingSettings) setTimeout(saveNow, 1000);
    savingSettings = true;
}

const settingChangeListener = new EventListener();


export function editSetting(setting, newValue) {
    settings[setting] = newValue;
    settingChangeListener.on('settingchange', { "key": setting, "value": newValue });
    saveSettings();
}

export { settings, settingChangeListener }

window.settings = settings;

loadSettings();
