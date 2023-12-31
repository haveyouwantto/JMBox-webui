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


export function dbToGain(db) {  return Math.pow(10, db / 20);}