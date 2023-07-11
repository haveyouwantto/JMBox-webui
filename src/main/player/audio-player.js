import { Player } from "./player";

let audioInit = false;
export class AudioPlayer extends Player {
    #audio;

    constructor(audioElement) {
        super();
        this.#audio = audioElement;


        if (!audioInit) {
            this.#audio.addEventListener('pause', e => {
                this.pause();
            });

            this.#audio.addEventListener('play', e => {
                this.play();
            })

            this.#audio.addEventListener('timeupdate', e => {
                if (this.observer) this.observer.ontimeupdate(this.currentTime);
            })

            this.#audio.addEventListener('ended', () => {
                if (this.observer) this.observer.onstop(this.currentTime);
            });

            this.#audio.addEventListener('error', e => {
                if (this.audio.src != 'null:' && this.observer) {
                    this.observer.onerror(e);
                }
            })

            audioInit = true;
        }
    }

    load(url) {
        return new Promise((resolve, reject) => {
            this.#audio.src = url;
            this.seek(0);
            resolve(super.load(url));
        })
    }

    play() {
        super.play();
        this.#audio.play();
    }

    pause() {
        super.pause();
        this.#audio.pause();
    }

    get duration() {
        return this.#audio.duration;
    }

    get currentTime() {
        return this.#audio.currentTime;
    }

    seek(seconds) {
        super.seek();
        this.#audio.currentTime = seconds;
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
        super.loop(value);
        this.#audio.loop = value;
    }

    get volume() {
        return this.#audio.volume;
    }

    set volume(value) {
        super.volume(value);
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