import Player from "./player";
import picoAudio from "../picoaudio";
import { loadMIDI } from "../picoaudio";

let picoAudioInit = false;

export default class PicoAudioPlayer extends Player {

    #paused = true;
    #lastPausedTime = 0;
    #intervalId = 0;

    constructor() {
        super();

        if (!picoAudioInit) {
            picoAudio.addEventListener('songEnd', e => {
                if (!this.loop) this.pause();
                this.listener.on('ended');
            });
            // document.addEventListener("visibilitychange", function () {
            //     if (document.hidden) {
            //         picoAudio.settings.WebMIDIWaitTime = 1000;
            //     } else {
            //         picoAudio.settings.WebMIDIWaitTime = settings.midiLatency;
            //     }
            // });
            picoAudioInit = true;
        }
    }

    load(url) {
        return loadMIDI(url);
    }

    loadPath(baseUrl, path) {
        return this.load(baseUrl + "api/midi" + path)
    }

    play() {
        super.play();
        if (this.ended) this.seek(0);
        this.#paused = false;
        picoAudio.play();
        // this.intervalId = setInterval(updatePlayback, 50);
        /*
        if (this.silent == null && settings.webmidi) {
            this.silent = picoAudio.context.createConstantSource();
            this.silent.offset.value = 0.01
            this.silent.connect(picoAudio.context.destination);
            this.silent.start();
        }
         */
    }

    pause() {
        super.pause();
        this.#lastPausedTime = this.currentTime;
        this.#paused = true;
        picoAudio.pause();
        /*
        clearInterval(this.intervalId);

        if (this.silent != null) {
            this.silent.stop();
            this.silent.disconnect(picoAudio.context.destination);
            delete this.silent;
        }*/
    }

    get duration() {
        if (picoAudio.playData == null) return NaN;
        else return picoAudio.getTime(picoAudio.playData.songLength);
    }

    get currentTime() {
        if (picoAudio.playData == null) return 0;
        else if (!picoAudio.states.isPlaying) return this.#lastPausedTime;
        else return picoAudio.context.currentTime - picoAudio.states.startTime;
    }

    seek(seconds) {
        super.seek(seconds);

        this.lastPausedTime = seconds;
        let playing = picoAudio.states.isPlaying;
        picoAudio.stop();
        picoAudio.initStatus(false, true);
        picoAudio.setStartTime(seconds);
        if (playing) picoAudio.play();
    }

    stop() {
        super.stop();
        picoAudio.stop();
        // clearInterval(this.intervalId);
    }

    get paused() {
        return this.#paused;
    }

    get loop() {
        return picoAudio.isLoop();
    }

    set loop(value) {
        super.loop = value;
        picoAudio.setLoop(value);
    }

    get volume() {
        return picoAudio.getMasterVolume();
    }

    set volume(value) {
        super.volume = value;
        picoAudio.setMasterVolume(value);
    }

    get bufferLength() {
        return 0;
    }
}