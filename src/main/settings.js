import EventListener from "./event-listener";

// For S&L configs

const defaultValue = {
    dark: 'unset',
    showInfo: true,
    webmidi: false,
    midisrc: false,
    player: "PicoAudioPlayer",
    playMode: 0,
    volume: 1,

    waveType: true,
    basePitch: 440,
    maxPolyphony: -1,
    skipBeginning: false,
    skipEnding: true,
    midiLatency: 250,
    lastMidiDevice: "",
    
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
    detailedNotes: false
}

const settings = {};
const prefix = 'jmbox';

/**
 * Load configurations from disk
 */
export function loadSettings() {
    const localStorage = window.localStorage;
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