import Player from "./player";
import { $ } from "../utils";
import { settings } from "../settings";
import picoAudio from "../picoaudio";

// <audio> 元素是单例，而切换播放器时上层会重建播放器实例。
// 原来的全局 audioInit 让原生事件永远挂在第一个（已被丢弃的）实例上：
// 当前实例收不到 play/pause/ended，旧实例的处理函数又会去调用当前播放器的方法，
// 元素状态、播放器状态、界面状态三者对不上，播放/暂停就会互相触发。这里改成单例。
let instance = null;

export default class AudioPlayer extends Player {
    #audio;

    constructor() {
        if (instance) return instance;
        super();
        instance = this;
        this.#audio = $("#audio");

        // 原生事件只负责通知上层，不再回调 play()/pause()：
        // 那属于重入（在事件回调里又一次调用同一事件的元素 API），
        // 元素在 seek、加载重启、出错等状态下可能重复派发事件，就会变成播放-暂停快速循环。
        this.#audio.addEventListener('play', () => {
            this.listener.on('play', this.currentTime);
        });

        this.#audio.addEventListener('pause', () => {
            this.listener.on('pause', this.currentTime);
        });

        this.#audio.addEventListener('timeupdate', e => {
            this.listener.on('timeupdate', this.currentTime);
        })

        this.#audio.addEventListener('ended', () => {
            this.listener.on('ended');
        });

        this.#audio.addEventListener('error', e => {
            if (!this.#audio.src.startsWith('null')) {
                this.listener.on('error', e);
            }
        })
    }

    load(url) {
        return new Promise((resolve, reject) => {
            this.#audio.src = url;
            this.seek(0);
            this.listener.on('loaded', url);
            resolve(super.load(url));
        })
    }

    loadPath(baseUrl, path) {
        return this.load(baseUrl + (settings.midisrc ? "api/midi" : "api/play") + path)
    }

    play() {
        super.play();
        if (!this.#audio.paused) return;
        this.#audio.play().catch(e => {
            // 被 pause()/load() 打断是正常现象
            if (e && e.name === 'AbortError') return;
            // 真的起不来（自动播放被拦截、源不可用……）时回到暂停状态，
            // 否则界面一直显示“播放中”，点暂停又没反应，状态就会反复翻转。
            this.pause();
        });
    }

    pause() {
        super.pause();
        if (this.#audio.paused) return;
        this.#audio.pause();
    }

    get duration() {
        if (isFinite(this.#audio.duration)) {
            return this.#audio.duration;
        } else if (picoAudio?.playData?.lastEventTime){
            return picoAudio.playData.lastEventTime;
        } else {
            return this.#audio.buffered.length > 0 ? this.#audio.buffered.end(0) : 0;
        }
    }

    get currentTime() {
        return this.#audio.currentTime;
    }

    seek(seconds) {
        super.seek();
        if (isFinite(seconds)) this.#audio.currentTime = seconds;
    }

    stop() {
        super.stop();
        this.pause();
        this.#audio.src = "null:"
    }

    get paused() {
        return this.#audio.paused;
    }

    get loop() {
        return this.#audio.loop;
    }

    set loop(value) {
        super.loop = value;
        this.#audio.loop = value;
    }

    get volume() {
        return this.#audio.volume;
    }

    set volume(value) {
        super.volume = value;
        this.#audio.volume = value;
    }

    get bufferLength() {
        for (let i = 0; i < this.#audio.buffered.length; i++) {
            let endTime = this.#audio.buffered.end(i);
            if (endTime > this.#audio.currentTime) {
                return endTime;
            }
        }
        return 0;
    }

}
