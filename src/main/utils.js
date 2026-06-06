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

export function resetMIDI(output, mute = false) {
    if (output != null) {
        for (let i = 0; i < 16; i++) {
            if (mute)
                output.send([0xB0 | i, 0x7A, 0x00]);  // All Notes Off

            // 发送额外的重置控制器事件
            output.send([0xB0 | i, 0x01, 0x00]);  // Modulation Wheel
            output.send([0xB0 | i, 0x0B, 0x7F]);  // Expression
            output.send([0xB0 | i, 0x40, 0x00]);  // Hold Pedal
            output.send([0xB0 | i, 0x41, 0x00]);  // Portamento
            output.send([0xB0 | i, 0x42, 0x00]);  // Sustenuto
            output.send([0xB0 | i, 0x43, 0x00]);  // Soft
            output.send([0xB0 | i, 0x44, 0x00]);  // Legato
            output.send([0xB0 | i, 0x45, 0x00]);  // Hold 2
            output.send([0xB0 | i, 0x07, 0x64]);  // Volume
            output.send([0xB0 | i, 0x0A, 0x40]);  // Pan
            // output.send([0xB0 | i, 0x65, 0x00]);  // Non-Registered Parameter (coarse)
            // output.send([0xB0 | i, 0x64, 0x00]);  // Non-Registered Parameter (fine)
            // output.send([0xB0 | i, 0x06, 0x02]);  // Registered Parameter (coarse)
            // output.send([0xB0 | i, 0x26, 0x01]);  // Registered Parameter (fine)
            output.send([0xB0 | i, 0x5B, 0x28]);  // Reverb
            output.send([0xB0 | i, 0x5D, 0x00]);  // Chorus

            // 发送 "Pitch Wheel" 和 "Channel Pressure" 事件
            output.send([0xE0 | i, 0x40, 0x40]);  // Pitch Wheel
            output.send([0xD0 | i, 0x00]);        // Channel Pressure

            output.send([0xC0 | i, 0x00]);  // Program Change

            // 发送 "All Controllers Off" 事件
            output.send([0xB0 | i, 0x7B, 0x00]);  // All Controllers Off
        }
    }
}

// 计算两个字符串的编辑距离（Levenshtein Distance）
function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,     // 删除
                dp[i][j - 1] + 1,     // 插入
                dp[i - 1][j - 1] + cost // 替换
            );
        }
    }
    return dp[a.length][b.length];
}

/**
 * 生成基于编辑距离的随机播放列表
 * @param {string[]} files 文件名数组
 * @param {string} startFile 起始文件名
 * @param {number} topK 每轮取距离最大的K个候选
 * @returns {string[]} 生成的播放顺序
 */
export function generatePlaylist(files, startFile, topK = 3) {
    const remaining = new Set(files);
    if (!remaining.has(startFile)) throw new Error("起始文件不在列表中！");
    const result = [startFile];
    remaining.delete(startFile);

    let current = startFile;
    while (remaining.size > 0) {
        // 计算距离
        const distances = Array.from(remaining).map(f => ({
            name: f,
            dist: editDistance(current, f)
        }));

        // 取距离最大的 topK
        distances.sort((a, b) => b.dist - a.dist);
        const candidates = distances.slice(0, Math.min(topK, distances.length));

        // 随机选择一个
        const next = candidates[Math.floor(Math.random() * candidates.length)].name;
        result.push(next);
        remaining.delete(next);
        current = next;
    }

    return result;
}