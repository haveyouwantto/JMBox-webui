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