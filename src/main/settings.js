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
    shuffle: false,

    soundQuality: '1',
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

    // ── 渲染器模式 ──
    rendererMode: "webgl",  // "webgl" | "canvas2d"

    // ── WebGL 通用 ──
    zScale: 16,
    // 音符 Bloom
    noteDecay: 1.0,
    noteBloomBase: 10,
    noteBloomIdle: 0.5,
    noteBloomMin: 1,
    // 播放线 Bloom
    playlineDecay: 2.5,
    playlineBaseEmissive: 0.25,
    playlineBoostMultiplier: 2.8,
    // 星星
    starDecay: 16.0,
    starBloomBase: 15.0,
    starBloomMin: 0.15,
    starCount: 2000,
    starSize: 0.2,
    starColorDim: '#1a3355',
    starColorBright: '#88bbff',
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
    nebulaViewDistance: 120,
    nebulaRightX: -50,
    nebulaBaseY: 10,
    nebulaDotSpacing: 2,
    nebulaDigitSpacing: 4,
    // 渲染器 & 后处理
    cameraFov: 55,
    cameraNear: 0.1,
    cameraFar: 2000,
    maxPixelRatio: 2,
    toneMappingExposure: 1.35,
    bloomStrength: 0.72,
    bloomRadius: 0.55,
    bloomThreshold: 0,
    // 场景
    fogColor: '#050510',
    fogDensity: 0.008,
    webglBackgroundColor: '#050510',
    // 灯光
    ambientLightColor: '#222244',
    ambientLightIntensity: 0.6,
    pointLightColor: '#ffffff',
    pointLightIntensity: 1.2,
    pointLightDistance: 200,
    directionalLightColor: '#8888ff',
    directionalLightIntensity: 0.4,
    // 布局
    trackWidth: 136,
    channelLaneStep: 0.18,
    channelLaneBase: 0.05,
    // 网格
    gridSize: 220,
    gridDivisions: 128,
    gridColorCenter: '#1a1a3a',
    gridColorEdge: '#0d0d20',
    // 播放线几何
    playlineRadiusTop: 0.25,
    playlineRadiusBottom: 0.25,
    playlineHeight: -1,   // -1 = auto (use trackWidth)
    // 侧轨
    railWidth: 0.15,
    railHeight: 0.5,
    railLength: 600,
    railPositionX: 65
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