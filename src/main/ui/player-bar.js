import { PlayerAdapter } from "../player/player-adapter";
import { $, formatTime } from "../utils";

const progressBar = $("#progress");
const progressBarInner = $("#playtime");
const bufferedBar = $("#bufferedtime");

const controlsLeft = $("#controlsLeft");
const songTitle = $("#songTitle");
const timeDisplay = $("#timeDisplay");
const durationDisplay = $("#durationDisplay");

const playButton = $("#play");
const nextButton = $("#next");
const prevButton = $("#prev");
const replayButton = $("#replay");
const playModeButton = $("#playMode");
const volumeControl = $("#volume");
const volumeControlInner = $("#volume-inner");

const playModeAltButton = $("#playModeAlt");
const altIcon = playModeAltButton.querySelector('icon');
const altText = playModeAltButton.querySelector('locale');

let currentDuration = 0;
let playerAdapter = new PlayerAdapter();
let paused = true;

export function setProgress(currentTime) {
    progressBarInner.style.width = (currentTime / currentDuration * 100) + "%";
    timeDisplay.innerText = formatTime(currentTime);
}

export function setDuration(duration) {
    if (isNaN(duration)) duration = Infinity;
    durationDisplay.innerText = formatTime(duration);
    currentDuration = duration;
}

export function setBufferLength(value) {
    bufferedBar.style.width = (value / currentDuration * 100) + "%";
}

export function setPaused(value) {
    if (value) {
        playButton.innerText = '\ue000';
    } else {
        playButton.innerText = '\ue00f';
    }
    paused = value;
}

export function setPlayerAdapter(adapter){
    playerAdapter = adapter;
}

function togglePause() {
    if (paused) {
        playerAdapter.play();
    } else {
        playerAdapter.pause();
    }
}

playButton.addEventListener('click', togglePause);

progressBar.addEventListener('click', e => {
    playerAdapter.seek(e.clientX / progressBar.clientWidth);
});

nextButton.addEventListener('click', e => {
    playerAdapter.next();
})

prevButton.addEventListener('click', e => {
    playerAdapter.prev();
});