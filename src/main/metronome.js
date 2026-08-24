/**
 * 节拍器（Metronome）——按播放进度触发
 *
 * 与渲染器（waterfall）和播放器（player / picoaudio）完全解耦：
 * - 只依赖 MIDI 解析结果（tempoTrack / beatTrack / header.resolution /
 *   lastEventTime），节拍与强弱拍的解析逻辑与 waterfall 一致；
 * - 不自带节拍时钟：以高频采样播放进度（timeSource）触发，节拍声只在
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
const LOOKAHEAD_MARGIN = 0.06;  // 延迟补偿模式下预排窗口的额外余量（覆盖帧间隔）
const MAX_JUMP_SECONDS = 2;     // 单次进度前进超过该值视为跳转（seek/节流恢复），不补拍
const MAX_CLICKS_PER_UPDATE = 32; // 单次更新补击的拍数硬上限（防御）
const BACKWARD_EPSILON = 0.02;   // 允许的轻微回退（时钟抖动），超过视为 seek/循环
const PAUSE_DETECT_MS = 150;     // 进度持续多久未前进才视为暂停（避免双采样源重复上报误判）

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
        // 播放进度采样器：() => 当前播放位置（秒）。传入后节拍器会定时
        // （setInterval）读取播放进度来触发，不依赖播放器的 timeupdate 频率；
        // 用 setInterval 而非 rAF，保证切到后台标签页时仍能采样（rAF 在后台会停）。
        this.timeSource = options.timeSource || null;
        this.pollInterval = options.pollInterval ?? 16;
        // 延迟补偿（秒）：>0 时把点击提前调度，让嗒声与“听到的音乐”对齐；
        // 只在音频走媒体元素（AudioPlayer）时需要，PicoAudio 与节拍器同走 AudioContext 无需补偿。
        this.latencyCompensation = options.latencyCompensation ?? 0;

        this._beats = [];
        this._enabled = false;
        this._lastPosition = null;
        this._timerId = null;
        this._staticSince = null;
        this._nextScheduledIndex = 0;
        this._pendingClicks = [];
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
     * 可传入 position 指定新的跟踪锚点；不传则保留当前锚点
     * （例如切换播放器后由 seek 同步位置决定）。
     */
    setMidiData(midiData, position) {
        this._beats = buildBeatSchedule(midiData);
        if (position != null) {
            this._lastPosition = Math.max(0, position || 0);
            this._resetScheduling(this._lastPosition);
        }
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
        this._resetScheduling(this._lastPosition);
        this._enabled = true;
        this._startPolling();
        return true;
    }

    /**
     * 停用节拍器。
     */
    stop() {
        this._enabled = false;
        this._stopPolling();
        this._cancelPendingClicks();
    }

    _startPolling() {
        if (!this.timeSource || this._timerId != null) return;
        this._timerId = setInterval(() => this._poll(), this.pollInterval);
    }

    _stopPolling() {
        if (this._timerId == null) return;
        clearInterval(this._timerId);
        this._timerId = null;
    }

    _poll() {
        if (!this._enabled || !this.timeSource) return;
        const position = this.timeSource();
        if (typeof position === 'number' && isFinite(position)) {
            this.update(position);
        }
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
            this._resetScheduling(position);
            return;
        }
        if (position <= prev + 1e-4) {
            // 进度未前进：可能是两个采样源（定时器 + timeupdate）重复上报同一位置，
            // 也可能是真的暂停。只有持续 PAUSE_DETECT_MS 未前进才取消预排。
            const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (this._staticSince == null) this._staticSince = nowMs;
            if (nowMs - this._staticSince >= PAUSE_DETECT_MS) {
                this._cancelPendingClicks();
                this._resetScheduling(position);
            }
            return;
        }
        this._staticSince = null;
        if (position - prev > this.maxJumpSeconds) {
            this._lastPosition = position;
            this._resetScheduling(position);
            return;
        }

        const beats = this._beats;
        if (this.latencyCompensation > 0 && this._audioContext) {
            this._updateCompensated(position);
        } else {
            // 严格窗口 (prev, position]：重复上报同一位置不会重复触发同一拍
            const from = upperBound(beats, prev);
            const to = upperBound(beats, position);
            if (to - from > this.maxClicksPerUpdate) {
                this._lastPosition = position;
                this._resetScheduling(position);
                return;
            }
            const now = this._audioContext ? this._audioContext.currentTime + 0.002 : 0;
            for (let i = from; i < to; i++) {
                this._playClick(now, beats[i].accent);
            }
            this._lastPosition = position;
        }
    }

    // 延迟补偿模式：把即将到达的拍提前调度，让嗒声与“听到的音乐”对齐
    _updateCompensated(position) {
        const beats = this._beats;
        const ctx = this._audioContext;
        const comp = this.latencyCompensation;
        const now = ctx.currentTime;

        // 1) 兜底：已越过但未预排的拍立即补响（帧间隔抖动/主线程卡顿时）
        const crossed = upperBound(beats, position);
        if (crossed - this._nextScheduledIndex > this.maxClicksPerUpdate) {
            // 大量未预排的拍（异常跳转）：不补爆音
            this._nextScheduledIndex = crossed;
        } else {
            for (let i = this._nextScheduledIndex; i < crossed; i++) {
                this._playClick(now + 0.002, beats[i].accent);
            }
        }

        // 2) 预排：lookahead 内尚未预排的拍，提前 comp 秒调度
        const horizon = position + comp + LOOKAHEAD_MARGIN;
        let i = Math.max(this._nextScheduledIndex, crossed);
        let count = 0;
        for (; i < beats.length && beats[i].time <= horizon; i++) {
            if (++count > this.maxClicksPerUpdate) break;
            const delay = beats[i].time - position;
            const audioTime = now + Math.max(0.002, delay - comp);
            const handle = this._playClick(audioTime, beats[i].accent);
            if (handle) this._pendingClicks.push({ handle, audioTime });
        }
        this._nextScheduledIndex = Math.max(this._nextScheduledIndex, i);
        this._prunePending(now);
        this._lastPosition = position;
    }

    // 重建调度指针（seek/回退/暂停/补偿量变化时），并取消未播放的预排点击
    _resetScheduling(position) {
        this._cancelPendingClicks();
        this._nextScheduledIndex = upperBound(this._beats, position);
    }

    _cancelPendingClicks() {
        for (const pending of this._pendingClicks) {
            try {
                pending.handle.cancel();
            } catch (e) {
                // 已播放完则忽略
            }
        }
        this._pendingClicks = [];
    }

    _prunePending(now) {
        if (this._pendingClicks.length === 0) return;
        this._pendingClicks = this._pendingClicks.filter(p => p.audioTime > now + 0.01);
    }

    /**
     * 与播放进度对齐（seek 后调用）：把跟踪位置设为目标点，跳过被跳过的拍。
     */
    sync(position) {
        this._lastPosition = Math.max(0, position || 0);
        this._resetScheduling(this._lastPosition);
    }

    /**
     * 设置延迟补偿（秒）。>0 时点击会提前调度（AudioPlayer 用）；PicoAudio 传 0。
     */
    setLatencyCompensation(seconds) {
        const value = Math.max(0, seconds || 0);
        if (value !== this.latencyCompensation) {
            this.latencyCompensation = value;
            // 补偿量变化时取消未播放的预排点击并重建调度指针
            this._resetScheduling(this._lastPosition != null ? this._lastPosition : 0);
        }
    }

    /**
     * 确保 AudioContext 已创建（供外部读取输出延迟等）。
     */
    ensureAudioContext() {
        this._ensureAudioContext();
    }

    /**
     * Web Audio 输出延迟估算（秒），无则返回 0。
     */
    audioLatency() {
        const ctx = this._audioContext;
        return ctx && typeof ctx.outputLatency === 'number' && ctx.outputLatency > 0 ? ctx.outputLatency : 0;
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
    _playClick(audioTime, accent) {
        const ctx = this._audioContext;
        if (!ctx) return null;
        const t = Math.max(audioTime, ctx.currentTime + 0.002);
        const gains = [];
        this._playNoise(t, gains);
        this._playTone(t, accent, gains);
        // 返回取消句柄：在播放前断开增益节点即可静音
        return {
            cancel: () => {
                for (const gain of gains) {
                    try {
                        gain.disconnect();
                    } catch (e) {
                        // 已断开则忽略
                    }
                }
            }
        };
    }

    // 白色噪声瞬态（非常短）
    _playNoise(t, gains) {
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
        gains.push(gain);
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
    _playTone(t, accent, gains) {
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
        gains.push(gain);
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
