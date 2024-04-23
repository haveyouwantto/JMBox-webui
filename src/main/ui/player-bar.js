import EventListener from "../event-listener";
import { $, formatTime } from "../utils";
import { settings, editSetting } from "../settings";

const progressBar = $("#progress");
const progressBarSlider = $("#progress-slider");
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
const volumeControlSlider = $("#volume-slider");
const volumeControlInner = $("#volume-inner");

const playModeAltButton = $("#playModeAlt");
const altIcon = playModeAltButton.querySelector('icon');
const altText = playModeAltButton.querySelector('locale');

const bottomMenuBtn = $("#bottomMenuBtn");
const bottomMenu = $("#bottomMenu");
const collapse = $("#collapse");
const playerLoading = $("#player-loading");

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

progressBarSlider.addEventListener('input', e => {
    playerAdapter.on('seek', progressBarSlider.value);
});

nextButton.addEventListener('click', e => {
    playerAdapter.on('next');
})

prevButton.addEventListener('click', e => {
    playerAdapter.on('prev');
});


export function setVolume(percentage) {
    volumeControlSlider.value = percentage * 100;
    volumeControlInner.style.width = (percentage * 100) + "%";
}

volumeControlSlider.addEventListener('input', e => {
    playerAdapter.on('volumechange', volumeControlSlider.value / 100);
})

// volumeControl.addEventListener('pointermove', e => {
//     if (e.buttons > 0) {
//         playerAdapter.on('volumechange', e.offsetX / volumeControl.clientWidth);
//     }
// });

// volumeControl.addEventListener('click', e => {
//     playerAdapter.on('volumechange', e.offsetX / volumeControl.clientWidth);
// });

export function setSongName(name) {
    songTitle.textContent = name;
}

export function getSongName(){
	return songTitle.textContent;
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

export function setPlayerLoading(value) {
    if (value) {
        progressBarInner.classList.add('player-loading');
    } else {
        progressBarInner.classList.remove('player-loading')
    }
}

bottomMenuBtn.addEventListener('click', () => {
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
    playerAdapter.on('titleclick');
})

export function setPlayModeIcon(mode) {
    switch (mode) {
        case 0:
            playModeButton.innerText = '\ue00b';
            altIcon.innerText = '\ue00b';
            break;
        case 1:
            playModeButton.innerText = '\ue00c';
            altIcon.innerText = '\ue00c';
            break;
        case 2:
            playModeButton.innerText = '\ue00d';
            altIcon.innerText = '\ue00d';
            break;
        case 3:
            playModeButton.innerText = '\ue00e';
            altIcon.innerText = '\ue00e';
            break;
        default:
            break;
    }
}


playModeButton.addEventListener('click', e => {
    let playMode = settings.playMode + 1;
    if (playMode == 4) playMode = 0;
    playerAdapter.on('playmodechange', playMode);
});


const wav = $("#wav");
const mid = $("#mid");

export function setMIDIDownload(baseUrl, path) {
    wav.href = baseUrl + "api/play" + path
    mid.href = baseUrl + "api/midi" + path
}