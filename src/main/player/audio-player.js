export class AudioPlayer {
    #audio;
    
    constructor(audioElement){
        this.#audio = audioElement;
    }
    /**
     * Loads a url
     * @param {string} url 
     * @param {Function} callback
     */
    load (url, callback, error) {
        this.#audio.src = url;
        this.seek(0);
        callback();
    }

    /**
     * Play the audio
     */
    play (){
        this.#audio.play();
    }

    /**
     * Pause the audio
     */
    pause  () {
        this.#audio.pause();
    }

    /**
     * Gets audio duration
     * @returns duration in seconds
     */
    duration () {
        return this.#audio.duration;
    }

    /**
     * Gets current audio progress
     * @returns progress in seconds
     */
    currentTime() {
        return this.#audio.currentTime;
    }

    /**
     * Seek audio in seconds
     * @param {float} seconds 
     */
    seek  (seconds) {
        this.#audio.currentTime = seconds;
    }

    /**
     * Seek audio by percentage
     * @param {float} percentage 
     */
    seekPercentage  (percentage) {
        this.seek(this.#audio.duration * percentage);
    }

    stop  () {
        this.pause();
        this.#audio.src = "null:"
    }

    isPaused () {
        return this.#audio.paused;
    }

    setLoop  (loop) {
        this.#audio.loop = loop;
    }

    getVolume  () {
        return this.#audio.volume;
    }

    setVolume (volume) {
        this.#audio.volume = volume;
    }

    replay () {
        this.seek(0);
        this.play();
    }

    getBuffer(){
        for (let i = 0; i < this.#audio.buffered.length; i++) {
            let endTime = this.#audio.buffered.end(i);
            if (endTime > this.#audio.currentTime) {
                return endTime;
            }
        }
        return 0;
    }

    // if (!audioInit) {
    //     this.audio.addEventListener('pause', e => {
    //         this.pause();
    //     });

    //     this.audio.addEventListener('play', e => {
    //         this.play();
    //     })

    //     this.audio.addEventListener('timeupdate', e => {
    //         updatePlayback();
    //         for (let i = 0; i < this.audio.buffered.length; i++) {
    //             let endTime = this.audio.buffered.end(i);
    //             if (endTime > this.audio.currentTime) {
    //                 updateBuffer(endTime, this.audio.duration);
    //                 break;
    //             }
    //         }
    //     })

    //     this.audio.addEventListener('ended', onended);

    //     this.audio.addEventListener('error', e => {
    //         if (this.audio.src != 'null:') {
    //             let dialog = new Dialog();
    //             dialog.setTitle(getLocale("player.failed"));
    //             dialog.addText(getLocale("player.failed.description"));
    //             dialog.setVisible(true);
    //         }
    //     })

    //     audioInit = true;
    // }
}