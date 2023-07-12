import { EventListener } from "../event-listener";

export class Player {
    constructor() {
        this.listener = new EventListener();
    }
    /**
     * Loads a url
     * @param {string} url 
     * @returns {Promise} Promise
     */
    load(url) {
        // Implementation for loading the URL
        // Call the callback function once the URL is loaded successfully
        this.listener.on('load', url);
    }

    /**
     * Play the audio
     */
    play() {
        // Implementation for playing the audio
        this.listener.on('play', this.currentTime);
    }

    /**
     * Pause the audio
     */
    pause() {
        // Implementation for pausing the audio
        this.listener.on('pause', this.currentTime);
    }

    /**
     * Gets audio duration
     * @returns duration in seconds
     */
    get duration() {
        // Implementation for getting the audio duration
        // Return the duration in seconds
    }

    /**
     * Gets current audio progress
     * @returns progress in seconds
     */
    get currentTime() {
        // Implementation for getting the current audio progress
        // Return the progress in seconds
    }

    /**
     * Seek audio in seconds
     * @param {float} seconds 
     */
    seek(seconds) {
        // Implementation for seeking the audio to the specified seconds
        this.listener.on('seek', seconds);
    }

    /**
     * Seek audio by percentage
     * @param {float} percentage 
     */
    seekPercentage(percentage) {
        this.seek(this.duration * percentage);
    }

    stop() {
        // Implementation for stopping the audio playback
        this.listener.on('stop');
    }

    /**
     * Check if the audio is paused
     * @returns {boolean} paused
     */
    get paused() {
        // Implementation for getting the paused state of the audio
        // Return true if the audio is paused, false otherwise
    }

    /**
     * Get the loop state
     * @returns {boolean} loop
     */
    get loop() {
        // Implementation for getting the loop state of the audio
        // Return true if the audio is set to loop, false otherwise
    }

    /**
     * Set the loop state
     * @param {boolean} value 
     */
    set loop(value) {
        // Implementation for setting the loop state of the audio
        this.listener.on('loopchange', value);
    }

    /**
     * Get the volume level
     * @returns {number} volume
     */
    get volume() {
        // Implementation for getting the volume level of the audio
        // Return the volume level
    }

    /**
     * Set the volume level
     * @param {number} value 
     */
    set volume(value) {
        // Implementation for setting the volume level of the audio
        this.listener.on('volumechange', value);
    }

    /**
     * Replay the audio from the beginning
     */
    replay() {
        this.seek(0);
        this.play();
    }

    /**
     * Get the buffer length
     * @returns {number} bufferLength
     */
    get bufferLength() {
        // Implementation for getting the buffer length of the audio
        // Return the buffer length
    }

    setEventListener(event, listener) {
        this.listener.setEventListener(event, listener);
    }
}
