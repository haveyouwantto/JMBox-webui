import EventListener from "../event-listener";
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

const bottomMenuBtn = $("#bottomMenuBtn");
const bottomMenu = $("#bottomMenu");
const collapse = $("#collapse");

let currentDuration = 0;
let playerAdapter = new EventListener();
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

export function setEventListener(event, listener) {
    playerAdapter.setEventListener(event, listener);
}

function togglePause() {
    if (paused) {
        playerAdapter.on('play');
    } else {
        playerAdapter.on('pause');
    }
}

playButton.addEventListener('click', togglePause);

progressBar.addEventListener('click', e => {
    playerAdapter.on('seek', e.clientX / progressBar.clientWidth);
});

nextButton.addEventListener('click', e => {
    playerAdapter.on('next');
})

prevButton.addEventListener('click', e => {
    playerAdapter.on('prev');
});


export function setVolume(percentage) {
    volumeControlInner.style.width = (percentage * 100) + "%";
}

volumeControl.addEventListener('pointermove', e => {
    if (e.buttons > 0) {
        playerAdapter.on('volumechange', e.offsetX / volumeControl.clientWidth);
    }
});

volumeControl.addEventListener('click', e => {
    playerAdapter.on('volumechange', e.offsetX / volumeControl.clientWidth);
});

export function setSongName(name) {
    songTitle.textContent = name;
}


function setBottomMenuVisible(visible) {
    if (visible) {
        bottomMenu.classList.add('bottom-menu-visible');
        bottomMenu.classList.remove('bottom-menu-hidden');
        collapse.classList.remove('hidden');
    } else {
        bottomMenu.classList.remove('bottom-menu-visible');
        bottomMenu.classList.add('bottom-menu-hidden');
        collapse.classList.add('hidden')
    }
}

bottomMenuBtn.addEventListener('click',()=>{
    setBottomMenuVisible(true);
})

collapse.addEventListener('click', () => {
    setBottomMenuVisible(false);
});

bottomMenu.querySelectorAll('button').forEach(element => {
    element.addEventListener('click', () => {
        playerAdapter.on('menuitem', element.getAttribute('func'));
        setBottomMenuVisible(false);
    })
});

controlsLeft.addEventListener('click', e => {
    playerAdapter.on('titleclicked');
})