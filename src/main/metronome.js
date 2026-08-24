/**
 * 节拍器（Metronome）——按播放进度触发
 *
 * 与渲染器（waterfall）和播放器（player / picoaudio）完全解耦：
 * - 只依赖 MIDI 解析结果（tempoTrack / beatTrack / header.resolution /
 *   lastEventTime），节拍与强弱拍的解析逻辑与 waterfall 一致；
 * - 不自带时钟：由外部按播放进度调用 update(position) 触发，节拍声只在
 *   播放时间真正跨过某一拍时响起；暂停、seek、循环回绕时安静处理；
 * - 使用 Web Audio API 发声，不经过任何播放器。
 */

const DEFAULT_RESOLUTION = 480;
const ACCENT_FREQUENCY = 1760;  // 强拍（每小节第一拍）音高
const BEAT_FREQUENCY = 1175;    // 普通拍音高
const ACCENT_GAIN = 0.5;        // 强拍“叮”声的音量
const BEAT_GAIN = 0.25;         // 普通拍“嗒”声的音量
const BEAT_TONE_DURATION = 0.055; // 普通拍“嗒”音色的时长
const ACCENT_DURATION = 0.45;   // 强拍“叮”声的衰减时长
const NOISE_DURATION = 0.03;    // 每个节拍叠加的白色噪声长度（非常短）
const NOISE_GAIN = 0.3;         // 白色噪声音量
const MAX_JUMP_SECONDS = 2;     // 单次进度前进超过该值视为跳转（seek/节流恢复），不补拍
const MAX_CLICKS_PER_UPDATE = 32; // 单次更新补击的拍数硬上限（防御）
const BACKWARD_EPSILON = 0.02;   // 允许的轻微回退（时钟抖动），超过视为 seek/循环

// ---------------------------------------------------------------------------
// 以下 tick/秒 与 小节 解析逻辑与 src/main/ui/waterfall.js 保持一致
// ---------------------------------------------------------------------------

/**
 * 将秒转换为 tick（考虑速度变化）。
 */
function timeToTick(time, tempoTrack, resolution) {
    if (!tempoTrack || tempoTrack.length === 0 || !resolution) {
        return Math.round(time * 120 * resolution / 60);
    }
    let lo = 0, hi = tempoTrack.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (tempoTrack[mid].time <= time) lo = mid + 1;
        else hi = mid - 1;
    }
    const idx = Math.min(hi, tempoTrack.length - 1);
    if (idx < 0) return Math.round(time * 120 * resolution / 60);
    const ref = tempoTrack[idx];
    const ticksPerSecond = (ref.value / 60) * resolution;
    return ref.timing + Math.round((time - ref.time) * ticksPerSecond);
}

/**
 * 将 tick 转换为秒（考虑速度变化）。
 */
function tickToTime(tick, tempoTrack, resolution) {
    if (!tempoTrack || tempoTrack.length === 0 || !resolution) {
        return tick / (120 * resolution / 60);
    }
    let lo = 0, hi = tempoTrack.length - 1;
    while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (tempoTrack[mid].timing <= tick) lo = mid + 1;
        else hi = mid - 1;
    }
    const idx = Math.min(hi, tempoTrack.length - 1);
    if (idx < 0) return tick / (120 * resolution / 60);
    const ref = tempoTrack[idx];
    const ticksPerSecond = (ref.value / 60) * resolution;
    return ref.time + (tick - ref.timing) / ticksPerSecond;
}

/**
 * 从拍号轨道构建小节分段（与 waterfall 相同）：
 * 每个分段描述一段共享同一拍号的连续小节。
 */
function buildBarSegments(beatTrack, resolution) {
    const segments = [];
    const push = (startTick, sigNum, sigDen, firstBar) => {
        const last = segments[segments.length - 1];
        if (last && startTick === last.startTick) return;
        const ticksPerBeat = resolution * 4 / sigDen;
        segments.push({
            startTick,
            endTick: Infinity,
            ticksPerBar: sigNum * ticksPerBeat,
            ticksPerBeat,
            sigNum,
            sigDen,
            firstBar
        });
    };

    let events = [];
    if (beatTrack && beatTrack.length > 0) {
        events = beatTrack
            .filter(e => e && e.value && e.value[0] > 0 && e.value[1] > 0)
            .map(e => ({ timing: Math.max(0, e.timing), value: e.value }))
            .sort((a, b) => a.timing - b.timing)
            .filter((e, i, arr) => i === arr.length - 1 || arr[i + 1].timing !== e.timing);
    }

    let cursor = 0;
    let barNum = 1;
    let sigNum = 4, sigDen = 4;

    for (const ev of events) {
        if (ev.timing <= cursor) {
            sigNum = ev.value[0];
            sigDen = ev.value[1];
            continue;
        }
        const ticksPerBar = sigNum * resolution * 4 / sigDen;
        const delta = ev.timing - cursor;
        const barsElapsed = Math.floor(delta / ticksPerBar);
        const onBarline = delta % ticksPerBar === 0;
        push(cursor, sigNum, sigDen, barNum);
        barNum += barsElapsed + (onBarline ? 0 : 1);
        cursor = ev.timing;
        sigNum = ev.value[0];
        sigDen = ev.value[1];
    }

    push(cursor, sigNum, sigDen, barNum);
    for (let i = 0; i + 1 < segments.length; i++) {
        segments[i].endTick = segments[i + 1].startTick;
    }
    return segments;
}

/**
 * 根据 MIDI 的 tempoTrack / beatTrack 生成整曲节拍表。
 *
 * @param {object} midiData picoAudio.parseSMF 的返回结果
 * @returns {Array<{time: number, tick: number, accent: boolean, bar: number, beat: number}>}
 *          time 为绝对秒数；accent=true 表示强拍（每小节第一拍）
 */
export function buildBeatSchedule(midiData) {
    if (!midiData) return [];
    const tempoTrack = midiData.tempoTrack || [];
    const beatTrack = midiData.beatTrack || [];
    const resolution = (midiData.header && midiData.header.resolution) || DEFAULT_RESOLUTION;
    const endTime = midiData.lastEventTime ?? midiData.songLength ?? 0;
    if (!(endTime > 0)) return [];

    const segments = buildBarSegments(beatTrack, resolution);
    const endTick = timeToTick(endTime, tempoTrack, resolution);
    const beats = [];

    for (const seg of segments) {
        const segEndTick = Math.min(seg.endTick, endTick);
        let barStart = seg.startTick;
        let barsInto = 0;
        while (barStart < segEndTick && seg.ticksPerBar > 0) {
            for (let b = 0; b < seg.sigNum; b++) {
                const beatTick = barStart + b * seg.ticksPerBeat;
                if (beatTick >= segEndTick) break;
                beats.push({
                    time: tickToTime(beatTick, tempoTrack, resolution),
                    tick: beatTick,
                    accent: b === 0,
                    bar: seg.firstBar + barsInto,
                    beat: b + 1
                });
            }
            barStart += seg.ticksPerBar;
            barsInto++;
        }
    }

    beats.sort((a, b) => a.time - b.time);
    return beats;
}

// 找到第一个 time >= position 的拍（二分查找）
function lowerBound(beats, position) {
    let lo = 0, hi = beats.length - 1, ans = beats.length;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time < position) lo = mid + 1;
        else {
            ans = mid;
            hi = mid - 1;
        }
    }
    return ans;
}

// 找到第一个 time > position 的拍（二分查找）
function upperBound(beats, position) {
    let lo = 0, hi = beats.length - 1, ans = beats.length;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (beats[mid].time <= position) lo = mid + 1;
        else {
            ans = mid;
            hi = mid - 1;
        }
    }
    return ans;
}

/**
 * 节拍器——按播放进度触发，不自带时钟。
 *
 * 用法：
 *   const metronome = new Metronome();
 *   metronome.setMidiData(midiData);       // 设置 MIDI（可选，没有则不响）
 *   metronome.toggle(position);            // 启停（position 为当前播放位置）
 *   metronome.update(position);            // 播放器每次 timeupdate 时调用
 *   metronome.sync(position);              // seek 后调用，跳过被跳过的拍
 */
export class Metronome {
    constructor(options = {}) {
        this._audioContext = options.audioContext || null;
        this.accentFrequency = options.accentFrequency ?? ACCENT_FREQUENCY;
        this.beatFrequency = options.beatFrequency ?? BEAT_FREQUENCY;
        this.accentGain = options.accentGain ?? ACCENT_GAIN;
        this.beatGain = options.beatGain ?? BEAT_GAIN;
        this.accentDuration = options.accentDuration ?? ACCENT_DURATION;
        this.noiseGain = options.noiseGain ?? NOISE_GAIN;
        this.volume = options.volume ?? 1;
        this.maxJumpSeconds = options.maxJumpSeconds ?? MAX_JUMP_SECONDS;
        this.maxClicksPerUpdate = options.maxClicksPerUpdate ?? MAX_CLICKS_PER_UPDATE;

        this._beats = [];
        this._enabled = false;
        this._lastPosition = null;
        this._noiseBuffer = null;
        this._periodicWave = null;
    }

    get running() {
        return this._enabled;
    }

    get hasMidiData() {
        return this._beats.length > 0;
    }

    /**
     * 设置 MIDI 数据（tempoTrack / beatTrack / header.resolution）。
     * 同时把跟踪位置重置到 position（新歌从 0 开始）。
     */
    setMidiData(midiData, position = 0) {
        this._beats = buildBeatSchedule(midiData);
        this._lastPosition = Math.max(0, position || 0);
    }

    /**
     * 切换启停。position 为当前播放位置（秒），作为跟踪起点。
     * @returns {boolean} 是否处于启用状态
     */
    toggle(position = 0) {
        if (this._enabled) this.stop();
        else this.start(position);
        return this._enabled;
    }

    /**
     * 启用节拍器（不自带时钟，等 update() 喂播放进度）。
     * @param {number} position 当前播放位置（秒）
     * @returns {boolean} 是否成功启用
     */
    start(position = 0) {
        if (this._enabled || this._beats.length === 0) return false;
        this._ensureAudioContext();
        if (!this._audioContext) return false;
        if (this._audioContext.state === 'suspended') {
            this._audioContext.resume();
        }
        this._lastPosition = Math.max(0, position || 0);
        this._enabled = true;
        return true;
    }

    /**
     * 停用节拍器。
     */
    stop() {
        this._enabled = false;
    }

    /**
     * 按播放进度触发（播放器每次 timeupdate 时调用）。
     * 只会在播放时间跨过某一拍时响一声：
     * - 回退（seek 回退 / 循环回绕）→ 重置跟踪位置，不发声；
     * - 单次前进跨过过多拍（疑似未同步的跳转）→ 跳过，不补爆音。
     */
    update(position) {
        if (!this._enabled || this._beats.length === 0) return;
        position = Math.max(0, position || 0);
        const prev = this._lastPosition;
        if (prev == null) {
            this._lastPosition = position;
            return;
        }
        if (position < prev - BACKWARD_EPSILON) {
            this._lastPosition = position;
            return;
        }

        const from = upperBound(this._beats, prev);
        const to = lowerBound(this._beats, position + 0.001);
        if (position - prev > this.maxJumpSeconds || to - from > this.maxClicksPerUpdate) {
            this._lastPosition = position;
            return;
        }
        for (let i = from; i < to; i++) {
            this._playClick(this._beats[i].accent);
        }
        this._lastPosition = position;
    }

    /**
     * 与播放进度对齐（seek 后调用）：把跟踪位置设为目标点，跳过被跳过的拍。
     */
    sync(position) {
        this._lastPosition = Math.max(0, position || 0);
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(2, volume));
    }

    _ensureAudioContext() {
        if (!this._audioContext) {
            const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (Ctor) {
                this._audioContext = new Ctor({ latencyHint: 'balanced' });
            }
        }
        if (this._audioContext && (!this._noiseBuffer || !this._periodicWave)) {
            this._initAudioAssets();
        }
    }

    // 生成复用的音频素材：白色噪声 buffer + 单振荡器音色（PeriodicWave）
    _initAudioAssets() {
        const ctx = this._audioContext;
        if (!ctx) return;

        const sampleRate = ctx.sampleRate || 44100;
        const noiseLength = Math.max(1, Math.ceil(sampleRate * NOISE_DURATION));
        const buffer = ctx.createBuffer(1, noiseLength, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < noiseLength; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        this._noiseBuffer = buffer;

        // 单个 PeriodicWave：基音 + 少量整数泛音，音色介于“嗒”与“叮”之间
        const harmonics = 8;
        const real = new Float32Array(harmonics + 1);
        const imag = new Float32Array(harmonics + 1);
        imag[1] = 1;
        imag[2] = 0.3;
        imag[3] = 0.12;
        imag[4] = 0.06;
        imag[5] = 0.03;
        this._periodicWave = ctx.createPeriodicWave(real, imag);
    }

    // 每个节拍：极短的白色噪声（保证在音乐中清晰可闻） + 单个振荡器音色
    _playClick(accent) {
        const ctx = this._audioContext;
        if (!ctx) return;
        const t = ctx.currentTime + 0.002;
        this._playNoise(t);
        this._playTone(t, accent);
    }

    // 白色噪声瞬态（非常短）
    _playNoise(t) {
        const ctx = this._audioContext;
        if (!this._noiseBuffer) return;
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();

        src.buffer = this._noiseBuffer;
        src.loop = false;

        const peak = this.noiseGain * this.volume;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.001);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + NOISE_DURATION);

        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(t);
        src.stop(t + NOISE_DURATION + 0.005);
        src.onended = () => {
            try {
                src.disconnect();
                gain.disconnect();
            } catch (e) {
                // 已断开则忽略
            }
        };
    }

    // 音色部分：单个振荡器 + PeriodicWave；强拍更响更长（“叮”），普通拍短促
    _playTone(t, accent) {
        const ctx = this._audioContext;
        if (!this._periodicWave) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.setPeriodicWave(this._periodicWave);
        osc.frequency.value = accent ? this.accentFrequency : this.beatFrequency;

        const duration = accent ? this.accentDuration : BEAT_TONE_DURATION;
        const peak = (accent ? this.accentGain : this.beatGain) * this.volume;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.002);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + duration + 0.02);
        osc.onended = () => {
            try {
                osc.disconnect();
                gain.disconnect();
            } catch (e) {
                // 已断开则忽略
            }
        };
    }
}
