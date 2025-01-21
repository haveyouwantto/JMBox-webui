import picoAudio from "../picoaudio";
import {
    $
} from "../utils";
import {
    settings
} from "../settings";
import LyricsRoll from "../lrc-roll";

const waterfall = $("#waterfall");
const canvas = waterfall.querySelector('canvas');
const canvasCtx = canvas.getContext('2d');
const dpr = window.devicePixelRatio;

let fillColor = 'white';

const palette = [
    '#f44336', '#ff9800', '#ffc107', '#ffeb3b',
    '#cddc39', '#8bc34a', '#4caf50', '#009688',
    '#00bcd4', '#9e9e9e', '#03a9f4', '#2196f3',
    '#3f51b5', '#673ab7', '#9c27b0', '#e91e63'
]

let noteWidth = 0;
let keyboardHeight = 0;
let blackKeyHeight = 0;

const bwr = 12 / 7; // White key = n black key
const shiftval = 2 - bwr;
let maxNoteDuration = 30;

const notes = Array(128);

// 定义一个包含所有黑键的数组
const blackKeys = [1, 3, 6, 8, 10];
// 定义一个数组，包含所有白键的音符名称的编号
const whiteKeyNumbers = [0, 2, 4, 5, 7, 9, 11];


let animationId = null;

// Create a reference for the Wake Lock.
let wakeLock = null;
const wakeLockSupported = 'wakeLock' in navigator;

// for performance monitoring
let lastDrawTime = performance.now();
let timeList = []


let lrc = new LyricsRoll();
let lrcDiv = $("#lyrics");

export {
    lrc
};

lrc.onload = function (lyricsList) {
    lrcDiv.innerText = '';
    if (lyricsList.length > 0) {
        for (let i = 0; i < lyricsList.length; i++) {
            const lyrics = lyricsList[i];
            let segment = document.createElement('span');
            segment.id = 'lyrics-' + lyrics.ord;
            segment.innerText = lyrics.text;
            lrcDiv.appendChild(segment);
        }
    }
}

lrc.onlyrics = function (lyrics) {
    const lrcElement = document.getElementById('lyrics-' + lyrics.ord)
    lrcElement.classList.add('lyrics-highlight');
    if (lrcElement.offsetWidth > 0) lrcElement.scrollIntoView({
        block: "center",
        behavior: 'smooth'
    })
}

lrc.onseek = function (lyrics) {
    document.querySelectorAll('.lyrics-highlight').forEach(e => e.classList.remove('lyrics-highlight'));
    for (let i = 0; i <= lyrics.ord; i++) {
        document.getElementById('lyrics-' + i).classList.add('lyrics-highlight');
    }
    const lrcElement = document.getElementById('lyrics-' + lyrics.ord)
    lrcElement.scrollIntoView({
        block: "center",
        behavior: 'smooth'
    })
}


export function setVisible(value) {
    if (value) {
        waterfall.classList.remove('hidden');
        waterfall.classList.add('open');
        document.documentElement.classList.add('noscroll');

        startAnimation();
        acquireWakelock();
        resizeCanvas();
    } else {
        endAnimation();
        waterfall.classList.add('hidden');
        waterfall.classList.remove('open');
        document.documentElement.classList.remove('noscroll');
        if (wakeLockSupported && wakeLock != null) {
            wakeLock.release()
                .then(() => {
                    wakeLock = null;
                });
        }
    }
}

export function isVisible() {
    return waterfall.classList.contains('open');
}

export function toggle() {
    setVisible(!isVisible());
}

export function startAnimation() {
    if (animationId == null && isVisible()) {
        lastDrawTime = performance.now();
        if (settings.showLyrics) {
            if (picoAudio.playData) lrc.load(picoAudio.playData);
            lrc.seek(player.currentTime);
        }
        animationId = requestAnimationFrame(draw);
    }
}

export function endAnimation() {
    if (animationId != null) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

function acquireWakelock() {
    if (wakeLockSupported) {
        try {
            navigator.wakeLock.request('screen').then(lock => {
                wakeLock = lock;
                lock.addEventListener('release', e => {
                    console.log("wakelock released");
                })
            });
        } catch (error) {
            console.error(error);
        }
    }
}

document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === 'visible' && !waterfall.classList.contains('hidden')) {
        acquireWakelock();
    }
});


function isBlackKey(midiNoteNumber) {
    // Calculate the number (0-11) of the note name corresponding to the MIDI pitch number
    const noteNameNumber = midiNoteNumber % 12;
    // If the note name number is in the blackKeys array, the note is a black key
    return blackKeys.includes(noteNameNumber);
}

function getWhiteKeyNumber(midiNoteNumber) {
    // Calculate the number (0-11) of the note name corresponding to the MIDI pitch number
    const noteNameNumber = midiNoteNumber % 12;
    const mul = parseInt(midiNoteNumber / 12);
    // Return the number of the white key
    return whiteKeyNumbers.indexOf(noteNameNumber) + mul * 7;
}

function getStopTime(note) {
    let time;
    if (note.holdBeforeStop != null && note.holdBeforeStop.length > 0) {
        time = note.holdBeforeStop[0].time;
    } else {
        time = note.stopTime;
    }
    return Math.min(time, note.startTime + settings.maxNoteDuration);
}

function getNoteTransparency(velocity) {
    let transparency = Math.round(velocity * 255).toString(16);
    if (transparency.length < 2) {
        transparency = "0" + transparency;
    }
    return transparency;
}

function fastSpan(list, startTime, duration) {
    if (list.length == 0) return {
        notes: [],
        index: 0
    };
    // Define the left and right boundaries of the search interval
    let left = 0;
    let right = list.length - 1;

    // Use iterative method to implement binary search
    while (left <= right) {
        // Calculate the middle index
        const mid = Math.floor((left + right) / 2);

        // If the startTime of the middle element is less than or equal to startTime, search the right half
        if (list[mid].startTime <= startTime) {
            left = mid + 1;
        }
        // Otherwise, search the left half
        else {
            right = mid - 1;
        }
    }

    // Return the list of elements that meet the conditions
    const result = [];

    // The located position is the position of the first element whose startTime is greater than startTime
    let i = left;

    // Linear search to the right until startTime is greater than the current window
    while (i < list.length && list[i].startTime < startTime + duration) {
        result.push(list[i]);
        i++;
    }

    // Linear search to the left (for searching currently playing notes)
    i = left - 1;
    let stopTime = 0;
    let note;
    while (i >= 0) {
        note = list[i];
        // If the searched startTime is less than startTime-maxNoteDuration, ignore all previous notes
        if (startTime - note.startTime > maxNoteDuration) {
            break;
        }
        if (note.stopTime >= startTime) result.push(note);
        i--;
    }

    return {
        notes: result,
        index: left
    };
}

let player = null;

export function setPlayer(p) {
    player = p;
}

function getY(time, playTime, scaling) {
    return (time - playTime) * scaling;
}

export function drawFrame() {
    canvasCtx.globalCompositeOperation = 'copy';
    canvasCtx.fillStyle = "#ff000000";
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    canvasCtx.globalCompositeOperation = 'source-over';
    let playTime = player.currentTime;

    let scaling = canvas.height / settings.spanDuration;
    let noteCount = 0;
    let renderCount = 0;

    if (picoAudio.playData != null) {
        for (let i = 0; i < 16; i++) {
            canvasCtx.fillStyle = palette[i];
            canvasCtx.strokeStyle = palette[i];
            let result = fastSpan(picoAudio.playData.channels[i].notes, playTime, settings.spanDuration);
            noteCount += result.index;
            renderCount += result.notes.length;

            for (let note of result.notes) {
                let stopTime = getStopTime(note);
                let startY = getY(note.startTime, playTime, scaling);
                let endY = getY(stopTime, playTime, scaling)
                let x = note.pitch * noteWidth;

                if (settings.noteTransparency) {
                    canvasCtx.fillStyle = palette[i] + getNoteTransparency(note.velocity);
                }
                if (stopTime > playTime) {
                    if (!settings.detailedNotes) {
                        let y = canvas.height - endY - keyboardHeight;
                        let dx = noteWidth;
                        let dy = endY - startY;
                        canvasCtx.fillRect(x, y, dx, dy);
                    }

                    // Pressed key
                    if (note.startTime < playTime) {
                        notes[note.pitch] = i;

                        // Highlight notes
                        if (settings.highlightNotes && !settings.detailedNotes) {
                            canvasCtx.shadowOffsetX = 0;
                            canvasCtx.shadowOffsetY = 0;
                            canvasCtx.shadowBlur = noteWidth * 1.5;
                            canvasCtx.shadowColor = palette[i];
                            canvasCtx.fillStyle = "#ffffff60";

                            canvasCtx.fillRect(x, canvas.height - endY - keyboardHeight, noteWidth, endY - startY);
                            canvasCtx.fillStyle = palette[i];

                            canvasCtx.shadowOffsetX = 0;
                            canvasCtx.shadowOffsetY = 0;
                            canvasCtx.shadowBlur = 0;
                            canvasCtx.shadowColor = "transparent";
                        }
                    }

                }


                if (settings.detailedNotes) {
                    canvasCtx.lineWidth = 2;
                    canvasCtx.blendMode = 'multiply';
                    const noteStartY = canvas.height - startY - keyboardHeight;
                    const noteEndY = canvas.height - endY - keyboardHeight;

                    // Draw sustain pedal line
                    if (note.holdBeforeStop && note.holdBeforeStop.length > 0) {
                        const endY2 = canvas.height - getY(note.stopTime, playTime, scaling) - keyboardHeight;
                        canvasCtx.beginPath();
                        canvasCtx.moveTo(x + noteWidth * 0.5, noteEndY);
                        canvasCtx.lineTo(x + noteWidth * 0.5, endY2);
                        canvasCtx.moveTo(x, endY2);
                        canvasCtx.lineTo(x + noteWidth, endY2);
                        canvasCtx.stroke();
                    }

                    const controls = [
                        ...note.pitchBend.map(e => ({ t: 0, e: e })),
                        ...note.expression.map(e => ({ t: 1, e: e })),
                    ].sort((e1, e2) => e1.e.time - e2.e.time)

                    let centerX = x;
                    let width = noteWidth;
                    let yRecord = [];
                    canvasCtx.beginPath();
                    canvasCtx.moveTo(centerX, noteStartY);
                    canvasCtx.lineTo(centerX + noteWidth, noteStartY);
                    controls.forEach(control => {
                        switch (control.t) {
                            case 0: // pitch bend
                                centerX = x + control.e.value * noteWidth;
                                break
                            case 1: // expression
                                width = control.e.value / 127 * noteWidth;
                                break
                        }
                        let currentY = canvas.height - getY(control.e.time, playTime, scaling) - keyboardHeight;
                        canvasCtx.lineTo(centerX + width, currentY);
                        yRecord.push([centerX, currentY])
                    });
                    canvasCtx.lineTo(centerX + width, noteEndY);
                    canvasCtx.lineTo(centerX, noteEndY);
                    yRecord.reverse().forEach(xy => {
                        canvasCtx.lineTo(xy[0], xy[1]);
                    });

                    canvasCtx.closePath();
                    canvasCtx.fill();
                    if (note.startTime < playTime && stopTime > playTime && settings.highlightNotes) {
                        canvasCtx.fillStyle = '#ffffff60';
                        canvasCtx.fill();
                        canvasCtx.fillStyle = palette[i];
                    }
                }

            }
        }

        if (settings.showLyrics) lrc.update(playTime);
    }

    // Draw white keys
    canvasCtx.fillStyle = 'white';
    canvasCtx.fillRect(0, canvas.height - keyboardHeight, canvas.width, keyboardHeight);

    canvasCtx.fillStyle = 'gray';
    for (let i = 0; i < 128; i++) {
        if (!isBlackKey(i)) {
            let x = getWhiteKeyNumber(i) * bwr;
            if (notes[i] != null) {
                canvasCtx.fillStyle = palette[notes[i]];
                canvasCtx.fillRect(noteWidth * x, canvas.height - keyboardHeight, noteWidth * bwr, keyboardHeight);
                canvasCtx.fillStyle = 'gray';
                notes[i] = null;
            }

            canvasCtx.fillRect(noteWidth * x, canvas.height - keyboardHeight, 1, keyboardHeight); // Draw Seam
        }
    }

    canvasCtx.shadowOffsetX = 0;
    canvasCtx.shadowOffsetY = 0;
    canvasCtx.shadowBlur = noteWidth * 0.75;
    canvasCtx.shadowColor = "#00000080";

    canvasCtx.fillStyle = '#b71c1c';
    canvasCtx.fillRect(0, canvas.height - keyboardHeight - noteWidth * 0.5, canvas.width, noteWidth * 0.5);

    // Draw black keys
    canvasCtx.fillStyle = 'black';
    for (let i = 0; i < 128; i++) {
        if (isBlackKey(i)) {
            if (notes[i] != null) {
                canvasCtx.fillStyle = palette[notes[i]];
                notes[i] = null;
            }
            canvasCtx.fillRect(i * noteWidth, canvas.height - keyboardHeight, noteWidth, blackKeyHeight);
            canvasCtx.fillStyle = 'black';
        }
    }


    canvasCtx.shadowOffsetX = 0;
    canvasCtx.shadowOffsetY = 0;
    canvasCtx.shadowBlur = 0;
    canvasCtx.shadowColor = "transparent";

    if (settings.prefmon) {
        let drawTime = performance.now();
        let frameTime = drawTime - lastDrawTime;

        lastDrawTime = drawTime;
        timeList.push(frameTime);
        if (timeList.length > 250) {
            timeList.shift();
        }

        let c = 0;
        let t = 0
        for (let i = timeList.length - 1; i > 0; i--) {
            t += timeList[i];
            c++;
            if (t > 1000) {
                break;
            }
        }

        canvasCtx.fillStyle = '#00000080';
        canvasCtx.fillRect(0, 0, 260, 160);

        canvasCtx.fillStyle = "white";
        canvasCtx.font = "26px Sans-serif";
        canvasCtx.textAlign = "left";
        canvasCtx.textBaseline = "top";

        canvasCtx.fillText(`N: ${noteCount} R: ${renderCount}`, 0, 0);
        canvasCtx.fillText(`T: ${frameTime.toFixed(1)}  ${(c / t * 1000).toFixed(2)}fps`, 0, 26);


        canvasCtx.lineWidth = 1;
        canvasCtx.beginPath();
        canvasCtx.strokeStyle = "red";
        canvasCtx.moveTo(0, 150);
        canvasCtx.lineTo(250, 150);
        canvasCtx.stroke();

        canvasCtx.strokeStyle = "#ffffff80";
        for (let i = 0; i < 100; i += 20) {
            canvasCtx.beginPath();
            canvasCtx.moveTo(0, 150 - i);
            canvasCtx.lineTo(250, 150 - i);
            canvasCtx.stroke();
        }

        canvasCtx.lineWidth = 1.5;
        canvasCtx.strokeStyle = "white";
        canvasCtx.beginPath();
        canvasCtx.moveTo(0, 150 - frameTime);
        for (let i = 0; i < timeList.length; i++) {
            canvasCtx.lineTo(i, 150 - timeList[i]);
        }
        canvasCtx.stroke();
    }
}

function draw() {
    if (!waterfall.classList.contains('hidden')) {

        drawFrame();

        if (player.paused) {
            endAnimation();
        } else {
            animationId = requestAnimationFrame(draw);
        }
    }
}

function resizeCanvas() {
    let {
        width: cssWidth,
        height: cssHeight
    } = canvas.getBoundingClientRect();
    canvas.width = dpr * cssWidth;
    canvas.height = dpr * cssHeight;

    noteWidth = canvas.width / 128;
    keyboardHeight = noteWidth * 9;
    blackKeyHeight = noteWidth * 5.5;
    startAnimation();
}

window.onresize = resizeCanvas;

export function setLyricsVisible(b) {
    if (b) {
        if (picoAudio.playData) lrc.load(picoAudio.playData);
    } else {
        lrc.clear();
        lrcDiv.innerText = '';
    }
}

// // Create a new Resize Observer instance
// const resizeObserver = new ResizeObserver(entries => {
//     for (const entry of entries) {
//       // Execute your function here when the size changes
//       resizeCanvas();
//     }
//   });

// resizeObserver.observe(waterfall);