import EventListener from "../event-listener";
import { $, formatTime } from "../utils";


const dialog = $("#render-dialog");
const closeDialogButton = $("#close-render-button");
const progressBar = dialog.querySelector('.slider-inner')
const startRenderButton = $("#start-render-button")

const timeDisplay = dialog.querySelector('.timeDisplay')
const durationDisplay = dialog.querySelector('.durationDisplay')
const rendering = $("#rendering")
const download = $("#render-download-button")

const renderListener = new EventListener();

console.log(dialog, closeDialogButton)
let timeoutId = null;

dialog.addEventListener('animationend', function () {
    if (dialog.classList.contains('fade-out')) {
        dialog.classList.remove('fade-out')
        dialog.close();
    }
});

startRenderButton.addEventListener('click',()=>{
    renderListener.on('start')
})

closeDialogButton.addEventListener('click', () => {
    dialog.classList.add('fade-out');
});

export function setProgress(percentage) {
    progressBar.style.width = (percentage * 100) + '%'
}

export function setStartButtonEnabled(value){
    startRenderButton.disabled = !value
}

export function setVisible(visible) {
    if (visible) {
        dialog.showModal();
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

export function setTime(s){
    timeDisplay.innerText = formatTime(s)
}

export function setDuration(s){
    durationDisplay.innerText = formatTime(s)
}

export function setName(name){
    rendering.innerText = name;
}

export function setDownload(url,name){
    download.href = url;
    download.download = name;
    download.classList.remove('hidden')
}

export {renderListener}