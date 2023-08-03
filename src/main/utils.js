export function $(e, parent = document) {
    if (e instanceof HTMLElement) return e;
    if (e.startsWith("#")) return document.getElementById(e.slice(1));
    let l = parent.querySelectorAll(e);
    if (l.length == 1) return l[0];
    else return l;
}


export function padding(num) {
    if (isNaN(num) || !isFinite(num)) {
        return '**';
    }
    if (num < 10) {
        return '0' + num;
    }
    else {
        return num;
    }
}

export function formatTime(seconds) {
    if (isNaN(seconds) || !isFinite(seconds)) return "**:**";

    let sec = parseInt(seconds % 60);
    let minutes = seconds / 60;
    let min = parseInt(minutes % 60);
    if (minutes < 60) {
        return padding(min) + ':' + padding(sec);
    } else {
        let hours = minutes / 60;
        return padding(parseInt(hours)) + ':' + padding(min) + ':' + padding(sec);
    }
}

/**
 * Get a SI formatted string.
 * @param {number} n The number to convert.
 * @param {boolean} bin Use base 1024 instead of 1000.
 */
export function toSI(n, bin = false) {
    if (n == null) return "Unknown "
    let suffix = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];
    let base = bin ? 1024 : 1000;
    if (n < base) return parseInt(n) + " ";
    for (let i in suffix) {
        if (n < base) {
            return bin ? n.toFixed(2) + " " + suffix[i] : n.toFixed(2) + " " + suffix[i];
        }
        n /= base;
    }
    return (n * base).toLocaleString() + " " + suffix[suffix.length - 1];
}


/**
 * Update a checker
 * @param {HTMLElement} parent 
 * @param {boolean} value 
 */
export function updateChecker(parent, value) {
    let checker = $('icon[checker]', parent);
    let isRadio = checker.classList.contains("radio");

    if (value) {
        checker.classList.add('icon-checked');
        checker.innerText = isRadio ? '\ue01c' : '\ue013';
    } else {
        checker.classList.remove('icon-checked');
        checker.innerText = isRadio ? '\ue01b' : '\ue012';
    }
}

/**
 * Generate wave file from audio buffer
 * @param {AudioBuffer} audioBuffer 
 * @returns {ArrayBuffer} Wave file bytes
 */
export function generateWav(audioBuffer) {
    let a = audioBuffer.getChannelData(0), b = audioBuffer.getChannelData(1);

    const filesize = audioBuffer.length * 4 + 44;

    const bytes = new ArrayBuffer(filesize);
    const view = new DataView(bytes);

    setString(view, 0, 'RIFF')
    view.setUint32(4, filesize, true);
    setString(view, 8, 'WAVEfmt ')
    view.setUint32(16, 16, true)  // meta length

    view.setUint16(20, 1, true)   // type: pcm
    view.setUint16(22, 2, true)   // channels
    view.setUint32(24, audioBuffer.sampleRate, true)   // samplerate
    view.setUint32(28, audioBuffer.sampleRate * 2 * 2, true)    // byte rate
    view.setUint16(32, 4, true)   // block align
    view.setUint16(34, 16, true)   // bits per sample

    setString(view, 36, 'data')
    view.setUint32(40, audioBuffer.length * 2, true)   // length

    for (let i = 0; i < audioBuffer.length; i++) {
        view.setInt16(44 + i * 4, parseInt(a[i] * 32768), true)
        view.setInt16(46 + i * 4, parseInt(b[i] * 32768), true)
    }

    return bytes
}

function setString(dataView, byteOffset, string) {
    const encoder = new TextEncoder('utf-8');
    encoder.encode(string).forEach((e, i) => {
        dataView.setUint8(byteOffset + i, e)
    });
}