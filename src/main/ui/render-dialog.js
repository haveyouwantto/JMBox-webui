import EventListener from "../event-listener";
import { $, formatTime, updateChecker } from "../utils";


const dialog = $("#render-dialog");
const closeDialogButton = $("#close-render-button");
const progressBarOverall = dialog.querySelector('#render-progress-overall')
const progressBarTime = dialog.querySelector('#render-progress-time')
const startRenderButton = $("#start-render-button")

const timeDisplay = dialog.querySelector('.timeDisplay')
const durationDisplay = dialog.querySelector('.durationDisplay')
const renderingFilename = $("#rendering-filename")
const renderingStage = $("#rendering-stage")
const download = $("#render-download-button")

const renderVideoBtn = $("#render-video-btn");
const renderAudioBtn = $("#render-audio-btn");
const videoOptions = $("#video-options");
const resolutionSelect = $("#render-resolution");
const fpsSelect = $("#render-fps");
const previewCanvas = $("#render-preview");
let previewCtx = previewCanvas.getContext('2d');

let videoEnabled = false;
let audioEnabled = true;
let prepared = false;
let rendering = false;

renderVideoBtn.addEventListener('click', () => {
    videoEnabled = !videoEnabled;
    updateChecker(renderVideoBtn, videoEnabled);
    if (videoEnabled) {
        videoOptions.classList.remove('hidden');
        previewCanvas.style.display = 'block';
    } else {
        videoOptions.classList.add('hidden');
        previewCanvas.style.display = 'none';
    }
    validateStartButton();
});

renderAudioBtn.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    updateChecker(renderAudioBtn, audioEnabled);
    validateStartButton();
});


function validateStartButton() {
    startRenderButton.disabled = !((videoEnabled || audioEnabled) && prepared && !rendering);
}

export function setRendering(value) {
    rendering = value;
    validateStartButton();
}

export function checkApiAvailability() {
    const webcodecs = 'VideoEncoder' in window;
    const fileSystem = 'showSaveFilePicker' in window;
    if (!webcodecs || !fileSystem) {
        renderVideoBtn.style.display = 'none';
        videoOptions.classList.add('hidden');
        videoEnabled = false;
        updateChecker(renderVideoBtn, videoEnabled);
    } else {
        renderVideoBtn.style.display = 'flex';
    }
}

export function isVideoEnabled() {
    return videoEnabled;
}

export function isAudioEnabled() {
    return audioEnabled;
}

export function getResolution() {
    return parseInt(resolutionSelect.value);
}

export function getFps() {
    return parseInt(fpsSelect.value);
}

export function drawPreview(bitmap) {
    if (!previewCtx && previewCanvas) {
        previewCtx = previewCanvas.getContext('2d');
    }

    if (previewCtx) {
        if (previewCanvas.width !== bitmap.width) {
            previewCanvas.width = bitmap.width;
            previewCanvas.height = bitmap.height;
        }
        previewCtx.drawImage(bitmap, 0, 0);
    }
}

const renderListener = new EventListener();

let timeoutId = null;

dialog.addEventListener('animationend', function () {
    if (dialog.classList.contains('fade-out')) {
        dialog.classList.remove('fade-out')
        dialog.close();
    }
});

startRenderButton.addEventListener('click', () => {
    download.classList.add('hidden')
    renderListener.on('start')
})

closeDialogButton.addEventListener('click', () => {
    dialog.classList.add('fade-out');
});

export function setProgress(percentage) {
    progressBarOverall.style.width = (percentage * 100) + '%'
}

export function setTimeProgress(percentage) {
    progressBarTime.style.width = (percentage * 100) + '%'
}

export function setStartButtonEnabled(value) {
    startRenderButton.disabled = !value
}

export function setVisible(visible) {
    if (visible) {
        dialog.showModal();
        validateStartButton();
    } else {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = null
        dialog.classList.add('fade-out')
    }
}

export function closeAfter(ms) {
    timeoutId = setTimeout(setVisible, ms, false)
}

export function setTime(s) {
    timeDisplay.innerText = formatTime(s)
}

export function setDuration(s) {
    durationDisplay.innerText = formatTime(s)
}

export function setName(name) {
    renderingFilename.innerText = name;
}

export function setStage(stage) {
    renderingStage.innerText = stage;
}

export function setDownload(url, name) {
    download.href = url;
    download.download = name;
    download.classList.remove('hidden')
}

export function setAvailable(available) {
    prepared = available;
}

export { renderListener }