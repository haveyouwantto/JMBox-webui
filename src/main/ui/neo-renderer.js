import { collectBarLines, palette as LEGACY_PALETTE } from "./waterfall";

const TAU = Math.PI * 2;
const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const BLACK_KEYS = [1, 3, 6, 8, 10];
const FIFTH = Array.from({ length: 12 }, (_, pc) => (pc * 7) % 12);
const PAL_HEX = [
    "#ff4d6d", "#ffb703", "#3ddc97", "#4cc9f0",
    "#b388ff", "#ff7b00", "#00f5d4", "#f72585",
    "#a3e635", "#f1f5ff", "#60a5fa", "#fb7185",
    "#facc15", "#34d399", "#c084fc", "#f97316"
];
const PAL = PAL_HEX.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(","));
const PALN = PAL.map(rgb => rgb.split(",").map(Number));
const LEGACY_PAL = LEGACY_PALETTE.map(hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(","));
const LEGACY_PALN = LEGACY_PAL.map(rgb => rgb.split(",").map(Number));
const TRAIL_STEP = 0.035;
const TRAIL_BREAK = 8;
const TRAIL_SPD = 0.55;

const isBlack = note => BLACK_KEYS.includes(((note % 12) + 12) % 12);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => min + Math.random() * (max - min);
const lb = (list, value, key) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (key(list[middle]) < value) low = middle + 1;
        else high = middle;
    }
    return low;
};

function makeGlow(rgb) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.12, `rgba(${rgb},0.95)`);
    gradient.addColorStop(0.4, `rgba(${rgb},0.28)`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    return canvas;
}

function makeGauss(rgb) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (let i = 0; i <= 12; i++) {
        const q = i / 12;
        const alpha = Math.exp(-0.5 * (q / 0.38) ** 2) * (1 - q ** 4);
        const white = 0.55 * Math.exp(-0.5 * (q / 0.2) ** 2);
        const r = rgb[0] + (255 - rgb[0]) * white | 0;
        const g = rgb[1] + (255 - rgb[1]) * white | 0;
        const b = rgb[2] + (255 - rgb[2]) * white | 0;
        gradient.addColorStop(q, `rgba(${r},${g},${b},${alpha.toFixed(4)})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return canvas;
}

const NEO_GLOW = PAL.map(makeGlow);
const NEO_GAUSS = PALN.map(makeGauss);
const LEGACY_GLOW = LEGACY_PAL.map(makeGlow);
const LEGACY_GAUSS = LEGACY_PALN.map(makeGauss);

function glow(renderer, channel, x, y, size, alpha = 1) {
    if (alpha <= 0.003) return;
    const context = renderer.ctx;
    context.globalAlpha = Math.min(1, alpha);
    context.drawImage(renderer.glowSprites[channel & 15], x - size / 2, y - size / 2, size, size);
    context.globalAlpha = 1;
}

function roundRect(renderer, x, y, width, height, radius) {
    const context = renderer.ctx;
    context.beginPath();
    if (context.roundRect) {
        context.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2)));
    } else {
        context.rect(x, y, width, height);
    }
}

function getStopTime(note, settings) {
    const heldTime = note.holdBeforeStop && note.holdBeforeStop.length > 0
        ? note.holdBeforeStop[0].time
        : note.stopTime;
    return Math.min(heldTime, note.startTime + settings.maxNoteDuration);
}

function buildScore(midiData, settings) {
    const notes = [];
    const maxNoteDuration = Math.max(1, Number(settings.maxNoteDuration) || 30);
    const endTime = Number(midiData && midiData.lastEventTime) || 0;
    let low = 127;
    let high = 0;
    let duration = endTime;

    if (midiData && midiData.channels) {
        for (let channel = 0; channel < 16; channel++) {
            const sourceChannel = midiData.channels[channel];
            if (!sourceChannel || !sourceChannel.notes) continue;
            for (const source of sourceChannel.notes) {
                const start = Number(source.startTime);
                if (!Number.isFinite(start)) continue;
                let stop = getStopTime(source, { maxNoteDuration });
                if (!Number.isFinite(stop)) stop = start + 0.04;
                stop = Math.min(stop, start + maxNoteDuration);
                if (stop - start < 0.04) stop = start + 0.04;
                const rawVelocity = Number.isFinite(source.midiVelocity)
                    ? source.midiVelocity
                    : (Number(source.velocity) || 0) * 127;
                const pitch = clamp(Math.round(Number(source.pitch) || 0), 0, 127);
                notes.push({
                    start,
                    end: stop,
                    note: pitch,
                    vel: clamp(rawVelocity, 1, 127),
                    ch: channel
                });
                low = Math.min(low, pitch);
                high = Math.max(high, pitch);
                duration = Math.max(duration, stop);
            }
        }
    }

    notes.sort((a, b) => a.start - b.start || a.ch - b.ch || a.note - b.note);
    if (notes.length === 0) {
        low = 48;
        high = 72;
    }

    let lo = Math.max(0, low - 2);
    let hi = Math.min(127, high + 2);
    while (hi - lo < 24 && (lo > 0 || hi < 127)) {
        lo = Math.max(0, lo - 1);
        hi = Math.min(127, hi + 1);
    }
    if (isBlack(lo) && lo > 0) lo--;
    if (isBlack(hi) && hi < 127) hi++;

    return {
        notes,
        lo,
        hi,
        maxDur: notes.reduce((maximum, note) => Math.max(maximum, note.end - note.start), 0),
        dur: duration + 0.3
    };
}

function trailX(pitch, score) {
    return ((pitch - score.lo) / Math.max(1, score.hi - score.lo) * 2 - 1) * 0.9;
}

const drumKind = note => (note === 35 || note === 36) ? 0
    : (note >= 37 && note <= 40) ? 1
        : (note === 42 || note === 44 || note === 46) ? 2
            : (note === 41 || note === 43 || note === 45 || note === 47 || note === 48 || note === 50) ? 3
                : (note === 49 || note === 51 || note === 52 || note === 55 || note === 57 || note === 59) ? 4
                    : 2;
const DRUM_GLOW = [9, 9, 9, 9, 9];
const DRUM_RGB = [
    [235, 240, 255], [235, 240, 255], [235, 240, 255],
    [235, 240, 255], [235, 240, 255]
];
const drumWX = note => {
    const kind = drumKind(note);
    const side = kind === 0 ? -1
        : kind === 1 ? 1
            : kind === 2 ? (note === 44 ? 1 : -1)
                : kind === 3 ? (note % 2 ? 1 : -1)
                    : (note % 2 ? -1 : 1);
    return side * (1.04 + 0.11 * ((note * 7) % 3));
};

function trailArc(x, y, phi, ex, ey) {
    const wx = ex - x;
    const wy = ey - y;
    const length = Math.hypot(wx, wy);
    if (length < 1e-12) return { x, y, phi, k: 0, len: 0, end: phi };
    const angle = Math.atan2(
        Math.cos(phi) * wy - Math.sin(phi) * wx,
        Math.cos(phi) * wx + Math.sin(phi) * wy
    );
    const sine = Math.sin(angle);
    if (Math.abs(angle) > 2.6) return null;
    return {
        x,
        y,
        phi,
        k: 2 * sine / length,
        len: Math.abs(sine) < 1e-6 ? length : length * angle / sine,
        end: phi + 2 * angle
    };
}

function trailBiarc(x0, y0, t0x, t0y, x1, y1, t1x, t1y) {
    const vx = x1 - x0;
    const vy = y1 - y0;
    const c = vx * vx + vy * vy;
    const b = vx * (t0x + t1x) + vy * (t0y + t1y);
    const a = 2 * (t0x * t1x + t0y * t1y - 1);
    let d = -1;
    if (Math.abs(a) < 1e-9) {
        if (b > 1e-9) d = c / (2 * b);
    } else {
        const discriminant = b * b - a * c;
        if (discriminant >= 0) d = (b - Math.sqrt(discriminant)) / a;
    }
    const phi0 = Math.atan2(t0y, t0x);
    if (d > 0 && d < 6 * Math.sqrt(c)) {
        const jx = (x0 + x1) / 2 + d * (t0x - t1x) / 2;
        const jy = (y0 + y1) / 2 + d * (t0y - t1y) / 2;
        const first = trailArc(x0, y0, phi0, jx, jy);
        const second = first && trailArc(jx, jy, first.end, x1, y1);
        if (first && second) return [first, second];
    }
    const single = trailArc(x0, y0, phi0, x1, y1);
    return [single || {
        x: x0,
        y: y0,
        phi: Math.atan2(vy, vx),
        k: 0,
        len: Math.sqrt(c),
        end: Math.atan2(vy, vx)
    }];
}

function trailPoly(arcs) {
    const points = [];
    const cumulative = [];
    let total = 0;
    for (const arc of arcs) {
        const steps = Math.max(2, Math.min(48, Math.ceil(Math.abs(arc.k * arc.len) / 0.1)));
        for (let i = points.length ? 1 : 0; i <= steps; i++) {
            const distance = arc.len * i / steps;
            if (Math.abs(arc.k) < 1e-9) {
                points.push(
                    arc.x + Math.cos(arc.phi) * distance,
                    arc.y + Math.sin(arc.phi) * distance
                );
            } else {
                points.push(
                    arc.x + (Math.sin(arc.phi + arc.k * distance) - Math.sin(arc.phi)) / arc.k,
                    arc.y - (Math.cos(arc.phi + arc.k * distance) - Math.cos(arc.phi)) / arc.k
                );
            }
            cumulative.push(total + distance);
        }
        total += arc.len;
    }
    return {
        pts: Float32Array.from(points),
        cum: Float32Array.from(cumulative),
        L: total
    };
}

function buildTrail(score) {
    const byChannel = new Map();
    const edges = [];
    for (const note of score.notes) {
        if (note.ch === 9) continue;
        note.wx = trailX(note.note, score);
        note.wy = note.start * TRAIL_SPD;
        note.par = null;
        note.kids = null;
        let list = byChannel.get(note.ch);
        if (!list) byChannel.set(note.ch, list = []);
        list.push(note);
    }

    const nearest = (list, pitch) => {
        let best = list[0];
        let distance = Infinity;
        for (const note of list) {
            const current = Math.abs(note.note - pitch);
            if (current < distance) {
                distance = current;
                best = note;
            }
        }
        return best;
    };

    const match = (previous, current) => {
        const n = previous.length;
        const m = current.length;
        const infinity = 1e9;
        const result = new Array(m).fill(-1);
        if (n * m > 1600) {
            for (let j = 0; j < m; j++) result[j] = previous.indexOf(nearest(previous, current[j].note));
            return result;
        }
        const costs = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(infinity));
        const picks = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
        costs[0][0] = 0;
        for (let i = 0; i <= n; i++) {
            for (let j = 0; j <= m; j++) {
                if (!i && !j) continue;
                if (i && j && costs[i - 1][j - 1] < infinity) {
                    const value = costs[i - 1][j - 1] + Math.abs(previous[i - 1].note - current[j - 1].note);
                    if (value < costs[i][j]) {
                        costs[i][j] = value;
                        picks[i][j] = 1;
                    }
                }
                if (i && n > m && costs[i - 1][j] < costs[i][j]) {
                    costs[i][j] = costs[i - 1][j];
                    picks[i][j] = 2;
                }
                if (j && m > n && costs[i][j - 1] < costs[i][j]) {
                    costs[i][j] = costs[i][j - 1];
                    picks[i][j] = 3;
                }
            }
        }
        for (let i = n, j = m; i > 0 || j > 0;) {
            const pick = picks[i][j];
            if (pick === 1) {
                result[j - 1] = i - 1;
                i--;
                j--;
            } else if (pick === 2) {
                i--;
            } else if (pick === 3) {
                j--;
            } else {
                break;
            }
        }
        return result;
    };

    for (const notes of byChannel.values()) {
        let previous = null;
        let current = null;
        let groupStart = -1;
        const flush = () => {
            if (!current) return;
            current.sort((a, b) => a.note - b.note);
            if (previous && current[0].start - previous[0].start <= TRAIL_BREAK) {
                const matches = match(previous, current);
                current.forEach((child, index) => {
                    const parent = matches[index] >= 0 ? previous[matches[index]] : nearest(previous, child.note);
                    child.par = parent;
                    (parent.kids || (parent.kids = [])).push(child);
                    child.fork = matches[index] < 0;
                });
            }
            previous = current;
            current = null;
        };
        for (const note of notes) {
            if (current && note.start - groupStart <= TRAIL_STEP) {
                current.push(note);
            } else {
                flush();
                current = [note];
                groupStart = note.start;
            }
        }
        flush();
    }

    const unit = (dx, dy) => {
        const length = Math.hypot(dx, dy) || 1;
        return [dx / length, dy / length];
    };

    for (const notes of byChannel.values()) {
        for (const note of notes) {
            let tx = 0;
            let ty = 0;
            if (note.par) {
                const direction = unit(note.wx - note.par.wx, note.wy - note.par.wy);
                tx += direction[0];
                ty += direction[1];
            }
            if (note.kids) {
                let ox = 0;
                let oy = 0;
                for (const child of note.kids) {
                    const direction = unit(child.wx - note.wx, child.wy - note.wy);
                    ox += direction[0];
                    oy += direction[1];
                }
                tx += ox / note.kids.length;
                ty += oy / note.kids.length;
            }
            if (!note.par && !note.kids) ty = 1;
            ty = Math.max(ty, 0.35 * Math.hypot(tx, ty), 1e-6);
            const direction = unit(tx, ty);
            note.tx = direction[0];
            note.ty = direction[1];
        }
    }

    for (const notes of byChannel.values()) {
        for (const child of notes) {
            if (!child.par) continue;
            const parent = child.par;
            edges.push({
                ta: parent.start,
                tb: child.start,
                ch: child.ch,
                v: child.vel,
                arcs: trailBiarc(
                    parent.wx, parent.wy, parent.tx, parent.ty,
                    child.wx, child.wy, child.tx, child.ty
                ),
                poly: null
            });
        }
    }
    edges.sort((a, b) => a.tb - b.tb);
    return { edges };
}

const Cascade = {
    name: "Cascade",
    vis: 3,

    init() {
        this.vis = 3;
    },

    layout(renderer) {
        const score = renderer.score;
        this.lo = score.lo;
        this.hi = score.hi;
        let whites = 0;
        for (let note = score.lo; note <= score.hi; note++) {
            if (!isBlack(note)) whites++;
        }
        const whiteWidth = this.ww = renderer.W / Math.max(1, whites);
        this.kx = new Float32Array(128);
        this.kw = new Float32Array(128);
        let whiteIndex = 0;
        for (let note = score.lo; note <= score.hi; note++) {
            if (isBlack(note)) {
                this.kx[note] = whiteIndex * whiteWidth - whiteWidth * 0.3;
                this.kw[note] = whiteWidth * 0.6;
            } else {
                this.kx[note] = whiteIndex * whiteWidth;
                this.kw[note] = whiteWidth;
                whiteIndex++;
            }
        }
        this.vis = clamp(Number(renderer.settings.spanDuration) || 3, 0.8, 12);
        this.kh = Math.max(70, Math.min(130, renderer.H * 0.14));
        this.hitY = renderer.H - this.kh;
    },

    hit(renderer, note) {
        const x = this.kx[note.note] + this.kw[note.note] / 2;
        const count = 6 + note.vel / 14;
        for (let i = 0; i < count; i++) {
            renderer.spawn(
                x + rand(-1, 1) * this.kw[note.note] * 0.4,
                this.hitY,
                rand(-90, 90),
                rand(-420, -120),
                rand(0.5, 1.1),
                note.ch,
                rand(6, 16),
                380
            );
        }
    },

    draw(renderer, time, delta) {
        const context = renderer.ctx;
        const PAL = renderer.paletteRgb;
        const W = renderer.W;
        const H = renderer.H;
        const score = renderer.score;
        const keyboardHeight = this.kh;
        const hitY = this.hitY;
        const pixelsPerSecond = hitY / this.vis;

        context.globalCompositeOperation = "source-over";
        const background = context.createLinearGradient(0, 0, 0, H);
        background.addColorStop(0, "#05060f");
        background.addColorStop(1, "#0c0e22");
        context.fillStyle = background;
        context.fillRect(0, 0, W, H);

        for (let note = this.lo; note <= this.hi; note++) {
            if (isBlack(note)) {
                context.fillStyle = "rgba(0,0,0,0.25)";
                context.fillRect(this.kx[note], 0, this.kw[note], hitY);
            } else if (note % 12 === 0 || note % 12 === 5) {
                context.fillStyle = note % 12 === 0 ? "rgba(150,170,255,0.09)" : "rgba(150,170,255,0.035)";
                context.fillRect(this.kx[note], 0, 1, hitY);
            }
        }

        if (renderer.settings.showBarLines !== false && renderer.midiData) {
            const lines = collectBarLines(renderer.midiData, time, this.vis);
            for (const line of lines) {
                const y = hitY - (line.time - time) * pixelsPerSecond;
                context.fillStyle = line.kind === "bar" ? "rgba(170,180,255,0.10)" : "rgba(170,180,255,0.035)";
                context.fillRect(0, y, W, line.kind === "bar" ? 1.5 : 1);
            }
        }

        context.globalCompositeOperation = "lighter";
        for (const note of renderer.activeNotes) {
            const beam = context.createLinearGradient(0, hitY, 0, hitY - H * 0.7);
            beam.addColorStop(0, `rgba(${PAL[note.ch]},${0.12 + note.vel / 127 * 0.18})`);
            beam.addColorStop(1, `rgba(${PAL[note.ch]},0)`);
            context.fillStyle = beam;
            context.fillRect(this.kx[note.note], hitY - H * 0.7, this.kw[note.note], H * 0.7);
        }

        context.globalCompositeOperation = "source-over";
        const notes = score.notes;
        for (let i = lb(notes, time - score.maxDur, note => note.start); i < notes.length && notes[i].start < time + this.vis; i++) {
            const note = notes[i];
            if (note.end < time || note.note < this.lo || note.note > this.hi) continue;
            let y1 = hitY - (note.start - time) * pixelsPerSecond;
            const y0 = hitY - (note.end - time) * pixelsPerSecond;
            if (y1 > hitY) y1 = hitY;
            const height = Math.max(3, y1 - y0);
            const x = this.kx[note.note] + 1;
            const width = Math.max(2, this.kw[note.note] - 2);
            const active = note.start <= time;

            context.shadowBlur = active ? 18 : 0;
            context.shadowColor = `rgb(${PAL[note.ch]})`;
            roundRect(renderer, x, y1 - height, width, height, Math.min(5, width / 3));
            context.fillStyle = `rgba(${PAL[note.ch]},${0.55 + 0.45 * note.vel / 127})`;
            context.fill();
            context.shadowBlur = 0;
            if (active) {
                context.fillStyle = "rgba(255,255,255,0.28)";
                context.fill();
            }
            context.fillStyle = "rgba(255,255,255,0.22)";
            context.fillRect(x + 1.5, y1 - height + 2, Math.max(1, width * 0.16), Math.max(0, height - 4));
            context.strokeStyle = "rgba(255,255,255,0.25)";
            context.lineWidth = 1;
            context.stroke();
        }

        context.globalCompositeOperation = "lighter";
        const hitLine = context.createLinearGradient(0, 0, W, 0);
        hitLine.addColorStop(0, "rgba(120,140,255,0.1)");
        hitLine.addColorStop(0.5, `rgba(200,160,255,${0.4 + Math.min(0.5, renderer.energy * 0.2)})`);
        hitLine.addColorStop(1, "rgba(120,140,255,0.1)");
        context.fillStyle = hitLine;
        context.fillRect(0, hitY - 3, W, 3);

        for (const note of renderer.activeNotes) {
            glow(
                renderer,
                note.ch,
                this.kx[note.note] + this.kw[note.note] / 2,
                hitY,
                Math.max(60, this.ww * 5) * (0.8 + note.vel / 127 * 0.6),
                0.9
            );
        }
        for (const note of renderer.activeNotes) {
            if (Math.random() < delta * 14) {
                renderer.spawn(
                    this.kx[note.note] + Math.random() * this.kw[note.note],
                    hitY,
                    rand(-20, 20),
                    rand(-200, -60),
                    rand(0.4, 0.8),
                    note.ch,
                    rand(4, 9),
                    -50
                );
            }
        }
        renderer.stepParticles(delta);

        context.globalCompositeOperation = "source-over";
        const pressed = new Int8Array(128).fill(-1);
        for (const note of renderer.activeNotes) pressed[note.note] = note.ch;
        const whiteGradient = context.createLinearGradient(0, hitY, 0, H);
        whiteGradient.addColorStop(0, "#c9cfe8");
        whiteGradient.addColorStop(0.15, "#f3f5ff");
        whiteGradient.addColorStop(1, "#d7dcf0");
        const pressedGradient = context.createLinearGradient(0, hitY, 0, H);
        pressedGradient.addColorStop(0, "rgba(255,255,255,0.65)");
        pressedGradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = "#05060c";
        context.fillRect(0, hitY, W, keyboardHeight);

        for (let note = this.lo; note <= this.hi; note++) {
            if (isBlack(note)) continue;
            const x = this.kx[note];
            const width = this.kw[note];
            const channel = pressed[note];
            context.fillStyle = channel >= 0 ? `rgb(${PAL[channel]})` : whiteGradient;
            roundRect(renderer, x + 0.5, hitY + (channel >= 0 ? 2 : 0), width - 1, keyboardHeight - (channel >= 0 ? 2 : 0), 4);
            context.fill();
            if (channel >= 0) {
                context.fillStyle = pressedGradient;
                context.fill();
            }
            if (note % 12 === 0 && width > 14) {
                context.fillStyle = "rgba(30,30,60,0.45)";
                context.font = "600 10px system-ui";
                context.textAlign = "center";
                context.fillText("C" + (note / 12 - 1), x + width / 2, H - 8);
            }
        }

        const blackGradient = context.createLinearGradient(0, hitY, 0, hitY + keyboardHeight * 0.62);
        blackGradient.addColorStop(0, "#2b2f44");
        blackGradient.addColorStop(1, "#0a0b12");
        for (let note = this.lo; note <= this.hi; note++) {
            if (!isBlack(note)) continue;
            const x = this.kx[note];
            const width = this.kw[note];
            const channel = pressed[note];
            const blackHeight = keyboardHeight * 0.62;
            context.fillStyle = channel >= 0 ? `rgb(${PAL[channel]})` : blackGradient;
            roundRect(renderer, x, hitY, width, blackHeight, 3);
            context.fill();
            context.fillStyle = channel >= 0 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.09)";
            context.fillRect(x + width * 0.2, hitY + 2, width * 0.6, blackHeight * 0.6);
        }

        const shadow = context.createLinearGradient(0, hitY, 0, hitY + 10);
        shadow.addColorStop(0, "rgba(0,0,0,0.6)");
        shadow.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = shadow;
        context.fillRect(0, hitY, W, 10);
    }
};

const Orbit = {
    name: "Orbit",
    cv: { x: 0, y: 0 },
    rings: [],
    stars: [],

    init() {
        this.stars = [];
        for (let i = 0; i < 450; i++) {
            this.stars.push({
                a: Math.random() * TAU,
                r: Math.sqrt(Math.random()) * 1.6,
                s: Math.random() * 1.4 + 0.4,
                p: Math.random() * TAU
            });
        }
        this.rings = [];
        this.cv = { x: 0, y: 0 };
    },

    layout(renderer) {
        this.cx = renderer.W / 2;
        this.cy = renderer.H / 2 + 8;
        this.R = Math.min(renderer.W, renderer.H) * 0.4;
    },

    onSeek() {
        this.rings = [];
        this.cv = { x: 0, y: 0 };
    },

    ang(index, u, time) {
        return index / 12 * TAU - TAU / 4 + u * 1.15 + time * 0.03;
    },

    pos(renderer, pitch, time, extra = 0) {
        const score = renderer.score;
        const u = (pitch - score.lo) / Math.max(1, score.hi - score.lo);
        const angle = this.ang(FIFTH[pitch % 12], u, time);
        const radius = this.R * (0.14 + 0.86 * u) + extra;
        return [
            this.cx + Math.cos(angle) * radius,
            this.cy + Math.sin(angle) * radius,
            angle
        ];
    },

    hit(renderer, note, time) {
        const [x, y, angle] = this.pos(renderer, note.note, time);
        this.rings.push({ x, y, r: 4, life: 1, ch: note.ch, w: 1 + note.vel / 40 });
        const count = 8 + note.vel / 10;
        for (let i = 0; i < count; i++) {
            const theta = Math.random() * TAU;
            const speed = rand(30, 170);
            renderer.spawn(
                x,
                y,
                Math.cos(theta) * speed - Math.sin(angle) * 90,
                Math.sin(theta) * speed + Math.cos(angle) * 90,
                rand(0.7, 1.6),
                note.ch,
                rand(5, 12),
                0,
                0.965
            );
        }
    },

    draw(renderer, time, delta) {
        const context = renderer.ctx;
        const PAL = renderer.paletteRgb;
        const W = renderer.W;
        const H = renderer.H;
        const score = renderer.score;
        const cx = this.cx;
        const cy = this.cy;
        const radius = this.R;

        context.globalCompositeOperation = "source-over";
        context.fillStyle = "rgba(4,5,12,0.2)";
        context.fillRect(0, 0, W, H);
        context.globalCompositeOperation = "lighter";

        for (const star of this.stars) {
            const angle = star.a + time * 0.012;
            const alpha = 0.05 + 0.05 * Math.sin(time * 2 + star.p);
            context.fillStyle = `rgba(200,210,255,${alpha})`;
            context.fillRect(
                cx + Math.cos(angle) * star.r * radius * 1.4,
                cy + Math.sin(angle) * star.r * radius * 1.1,
                star.s,
                star.s
            );
        }

        context.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
            context.strokeStyle = "rgba(140,160,255,0.022)";
            context.beginPath();
            for (let k = 0; k <= 24; k++) {
                const u = k / 24;
                const angle = this.ang(i, u, time);
                const currentRadius = radius * (0.14 + 0.86 * u);
                const x = cx + Math.cos(angle) * currentRadius;
                const y = cy + Math.sin(angle) * currentRadius;
                if (k) context.lineTo(x, y);
                else context.moveTo(x, y);
            }
            context.stroke();
            const labelAngle = this.ang(i, 1, time);
            context.font = "600 13px system-ui";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillStyle = "rgba(180,190,255,0.09)";
            context.fillText(
                NOTE_NAMES[(i * 7) % 12],
                cx + Math.cos(labelAngle) * radius * 1.09,
                cy + Math.sin(labelAngle) * radius * 1.09
            );
        }

        const notes = score.notes;
        const look = 2.5;
        for (let i = renderer.noteIndex, count = 0; i < notes.length && notes[i].start < time + look && count < 500; i++, count++) {
            const note = notes[i];
            const k = Math.max(0, (note.start - time) / look);
            const [x, y] = this.pos(renderer, note.note, time, k * k * radius * 0.9);
            glow(renderer, note.ch, x, y, 4 + (1 - k) * 14, (1 - k) * 0.55);
        }

        const active = renderer.activeNotes;
        if (active.length) {
            const points = active.map(note => {
                const position = this.pos(renderer, note.note, time);
                return { n: note, x: position[0], y: position[1] };
            });
            if (points.length >= 2 && points.length <= 14) {
                for (let i = 0; i < points.length; i++) {
                    for (let j = i + 1; j < points.length; j++) {
                        context.strokeStyle = `rgba(${PAL[points[i].n.ch]},0.12)`;
                        context.beginPath();
                        context.moveTo(points[i].x, points[i].y);
                        context.lineTo(points[j].x, points[j].y);
                        context.stroke();
                    }
                }
            }
            if (points.length >= 3) {
                const loud = points.reduce((a, b) => a.n.vel > b.n.vel ? a : b);
                const sorted = [...points].sort((a, b) =>
                    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
                );
                context.beginPath();
                sorted.forEach((point, index) => {
                    if (index) context.lineTo(point.x, point.y);
                    else context.moveTo(point.x, point.y);
                });
                context.closePath();
                context.fillStyle = `rgba(${PAL[loud.n.ch]},0.03)`;
                context.fill();
            }
            for (const point of points) {
                const pulse = 1 + 0.15 * Math.sin(time * 9 + point.n.note);
                glow(renderer, point.n.ch, point.x, point.y, (18 + point.n.vel * 0.45) * pulse, 0.9);
                const angle = time * 3 + point.n.note;
                glow(
                    renderer,
                    point.n.ch,
                    point.x + Math.cos(angle) * 14,
                    point.y + Math.sin(angle) * 14,
                    7,
                    0.7
                );
            }
        }

        let vx = 0;
        let vy = 0;
        for (const note of active) {
            const angle = this.ang(FIFTH[note.note % 12], 0, time);
            const weight = note.vel / 127;
            vx += Math.cos(angle) * weight;
            vy += Math.sin(angle) * weight;
        }
        if (active.length) {
            vx /= active.length;
            vy /= active.length;
        }
        const blend = Math.min(1, delta * 2.5);
        this.cv.x += (vx - this.cv.x) * blend;
        this.cv.y += (vy - this.cv.y) * blend;
        const magnitude = Math.hypot(this.cv.x, this.cv.y);
        const angle = Math.atan2(this.cv.y, this.cv.x);
        const sunX = cx + this.cv.x * radius * 0.15;
        const sunY = cy + this.cv.y * radius * 0.15;
        const fifthIndex = (((Math.round((angle + TAU / 4 - time * 0.03) / TAU * 12)) % 12) + 12) % 12;
        const hue = fifthIndex * 30;
        const sunRadius = radius * (0.07 + Math.min(0.08, renderer.energy * 0.03));
        const sun = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * 2.2);
        sun.addColorStop(0, `hsla(${hue},90%,80%,${0.18 + magnitude * 0.3})`);
        sun.addColorStop(0.35, `hsla(${hue},85%,60%,${0.06 + magnitude * 0.12})`);
        sun.addColorStop(1, `hsla(${hue},80%,50%,0)`);
        context.fillStyle = sun;
        context.beginPath();
        context.arc(sunX, sunY, sunRadius * 2.2, 0, TAU);
        context.fill();
        if (magnitude > 0.22) {
            context.font = "700 15px system-ui";
            context.textAlign = "center";
            context.fillStyle = `hsla(${hue},90%,85%,0.10)`;
            context.fillText(NOTE_NAMES[(fifthIndex * 7) % 12], sunX, sunY + sunRadius * 1.6);
        }
        for (const note of active) {
            const [x, y] = this.pos(renderer, note.note, time);
            context.strokeStyle = `rgba(${PAL[note.ch]},0.05)`;
            context.beginPath();
            context.moveTo(sunX, sunY);
            context.lineTo(x, y);
            context.stroke();
        }

        for (let i = this.rings.length - 1; i >= 0; i--) {
            const ring = this.rings[i];
            ring.life -= delta * 0.9;
            ring.r += delta * (90 + 60 * ring.life);
            if (ring.life <= 0) {
                this.rings.splice(i, 1);
                continue;
            }
            context.strokeStyle = `rgba(${PAL[ring.ch]},${ring.life * 0.5})`;
            context.lineWidth = ring.w * ring.life;
            context.beginPath();
            context.arc(ring.x, ring.y, ring.r, 0, TAU);
            context.stroke();
        }
        context.lineWidth = 1;
        renderer.stepParticles(delta);
    }
};

const Warp = {
    name: "Warp",
    VZ: 7,
    DMAX: 32,
    stars: [],
    flashes: [],

    init() {
        this.stars = [];
        for (let i = 0; i < 320; i++) this.stars.push(this.newStar(Math.random()));
        this.flashes = [];
    },

    newStar(z) {
        const angle = Math.random() * TAU;
        const radius = rand(0.3, 2.2);
        return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z };
    },

    layout(renderer) {
        this.F = Math.min(renderer.W, renderer.H) * 0.46;
    },

    onSeek() {
        this.flashes = [];
    },

    center(renderer, distance, time) {
        const k = 1 - 1 / distance;
        return [
            renderer.W / 2 + Math.sin(time * 0.35 + distance * 0.09) * renderer.W * 0.2 * k,
            renderer.H / 2 + Math.cos(time * 0.27 + distance * 0.07) * renderer.H * 0.16 * k
        ];
    },

    proj(renderer, angle, radius, distance, time) {
        const center = this.center(renderer, distance, time);
        const scale = this.F / distance;
        return [
            center[0] + Math.cos(angle) * radius * scale,
            center[1] + Math.sin(angle) * radius * scale
        ];
    },

    ang(pitch, time) {
        return (pitch % 12) / 12 * TAU + time * 0.12 + Math.floor(pitch / 12) * 0.14;
    },

    rad(renderer, pitch) {
        const score = renderer.score;
        return 1 - 0.62 * (pitch - score.lo) / Math.max(1, score.hi - score.lo);
    },

    hit(renderer, note, time) {
        const angle = this.ang(note.note, time);
        const radius = this.rad(renderer, note.note);
        const [x, y] = this.proj(renderer, angle, radius, 1, time);
        this.flashes.push({ a: angle, r: radius, life: 1, ch: note.ch, v: note.vel });
        const count = 8 + note.vel / 9;
        for (let i = 0; i < count; i++) {
            const speed = rand(120, 520);
            const theta = angle + rand(-0.6, 0.6);
            renderer.spawn(
                x,
                y,
                Math.cos(theta) * speed,
                Math.sin(theta) * speed,
                rand(0.4, 1),
                note.ch,
                rand(6, 16),
                0,
                0.95
            );
        }
    },

    draw(renderer, time, delta) {
        const context = renderer.ctx;
        const PAL = renderer.paletteRgb;
        const W = renderer.W;
        const H = renderer.H;
        const score = renderer.score;
        const focal = this.F;
        const depthScale = this.VZ;
        const maxDepth = this.DMAX;
        const energy = Math.min(2.5, renderer.energy);

        context.globalCompositeOperation = "source-over";
        context.fillStyle = "#03040a";
        context.fillRect(0, 0, W, H);
        const [vx, vy] = this.center(renderer, maxDepth, time);
        const vignette = context.createRadialGradient(vx, vy, 0, vx, vy, Math.max(W, H) * 0.6);
        vignette.addColorStop(0, `hsla(${(260 + time * 8) % 360},80%,${18 + energy * 8}%,0.9)`);
        vignette.addColorStop(0.35, `hsla(${(220 + time * 8) % 360},70%,8%,0.5)`);
        vignette.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = vignette;
        context.fillRect(0, 0, W, H);
        context.globalCompositeOperation = "lighter";

        const speed = (0.18 + energy * 0.45) * (renderer.playing ? 1 : 0.3);
        context.lineWidth = 1.2;
        for (let i = 0; i < this.stars.length; i++) {
            const star = this.stars[i];
            star.z -= delta * speed;
            if (star.z < 0.03) {
                this.stars[i] = this.newStar(1);
                continue;
            }
            const near = Math.min(1.2, star.z + delta * speed * 4 + 0.008);
            const center = this.center(renderer, 1 + star.z * maxDepth, time);
            const x1 = center[0] + star.x / star.z * focal * 0.35;
            const y1 = center[1] + star.y / star.z * focal * 0.35;
            const x0 = center[0] + star.x / near * focal * 0.35;
            const y0 = center[1] + star.y / near * focal * 0.35;
            context.strokeStyle = `rgba(190,205,255,${(1 - star.z) * 0.7})`;
            context.beginPath();
            context.moveTo(x0, y0);
            context.lineTo(x1, y1);
            context.stroke();
        }

        context.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
            const angle = i / 12 * TAU + time * 0.12 + TAU / 24;
            context.strokeStyle = "rgba(120,140,255,0.07)";
            context.beginPath();
            for (let k = 0; k <= 16; k++) {
                const distance = 1 + (maxDepth - 1) * (k / 16) ** 1.6;
                const point = this.proj(renderer, angle, 1.08, distance, time);
                if (k) context.lineTo(point[0], point[1]);
                else context.moveTo(point[0], point[1]);
            }
            context.stroke();
        }

        const horizon = (maxDepth - 1) / depthScale;
        if (renderer.settings.showBarLines !== false && renderer.midiData) {
            for (const line of collectBarLines(renderer.midiData, time, horizon)) {
                if (line.time < time || line.time > time + horizon) continue;
                const distance = 1 + (line.time - time) * depthScale;
                const center = this.center(renderer, distance, time);
                const fog = 1 - (distance - 1) / (maxDepth - 1);
                const down = line.kind === "bar";
                context.strokeStyle = down
                    ? `hsla(${(line.number * 7) % 360},90%,70%,${fog * 0.55})`
                    : `rgba(150,170,255,${fog * 0.2})`;
                context.lineWidth = (down ? 2.5 : 1) * Math.min(3, 4 / distance + 0.5);
                context.beginPath();
                context.arc(center[0], center[1], 1.1 * focal / distance, 0, TAU);
                context.stroke();
            }
        }

        const notes = score.notes;
        const deltaAngle = TAU / 24 * 0.82;
        for (let i = lb(notes, time - score.maxDur, note => note.start); i < notes.length && notes[i].start < time + horizon; i++) {
            const note = notes[i];
            if (note.end < time) continue;
            const nearDepth = Math.max(1, 1 + (note.start - time) * depthScale);
            const farDepth = Math.min(maxDepth, 1 + (note.end - time) * depthScale);
            if (farDepth <= nearDepth) continue;
            const angle = this.ang(note.note, time);
            const radius = this.rad(renderer, note.note);
            const active = note.start <= time;
            const fog = (1 - (nearDepth - 1) / (maxDepth - 1)) ** 1.3;
            const segments = Math.min(10, 2 + ((farDepth - nearDepth) / 2 | 0));
            context.beginPath();
            for (let k = 0; k <= segments; k++) {
                const point = this.proj(renderer, angle - deltaAngle, radius, nearDepth + (farDepth - nearDepth) * k / segments, time);
                if (k) context.lineTo(point[0], point[1]);
                else context.moveTo(point[0], point[1]);
            }
            for (let k = segments; k >= 0; k--) {
                const point = this.proj(renderer, angle + deltaAngle, radius, nearDepth + (farDepth - nearDepth) * k / segments, time);
                context.lineTo(point[0], point[1]);
            }
            context.closePath();
            context.fillStyle = `rgba(${PAL[note.ch]},${(active ? 0.85 : 0.5) * fog * (0.6 + 0.4 * note.vel / 127)})`;
            context.fill();
            if (active) {
                context.strokeStyle = "rgba(255,255,255,0.35)";
                context.stroke();
            }
        }

        const nearCenter = this.center(renderer, 1, time);
        context.strokeStyle = `rgba(200,180,255,${0.12 + energy * 0.08})`;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(nearCenter[0], nearCenter[1], 1.1 * focal, 0, TAU);
        context.stroke();

        for (const note of renderer.activeNotes) {
            const angle = this.ang(note.note, time);
            const radius = this.rad(renderer, note.note);
            const [x, y] = this.proj(renderer, angle, radius, 1, time);
            glow(renderer, note.ch, x, y, 50 + note.vel * 0.7, 0.85);
            if (Math.random() < delta * 25) {
                const speed = rand(80, 300);
                renderer.spawn(
                    x,
                    y,
                    Math.cos(angle) * speed + rand(-40, 40),
                    Math.sin(angle) * speed + rand(-40, 40),
                    rand(0.3, 0.7),
                    note.ch,
                    rand(4, 10),
                    0,
                    0.97
                );
            }
        }

        for (let i = this.flashes.length - 1; i >= 0; i--) {
            const flash = this.flashes[i];
            flash.life -= delta * 2.2;
            if (flash.life <= 0) {
                this.flashes.splice(i, 1);
                continue;
            }
            context.strokeStyle = `rgba(${PAL[flash.ch]},${flash.life * 0.9})`;
            context.lineWidth = (3 + flash.v / 16) * flash.life;
            context.beginPath();
            context.arc(
                nearCenter[0],
                nearCenter[1],
                flash.r * focal * (1 + (1 - flash.life) * 0.25),
                flash.a - deltaAngle * 1.4,
                flash.a + deltaAngle * 1.4
            );
            context.stroke();
        }
        context.lineWidth = 1;
        renderer.stepParticles(delta);
    }
};

const Trail = {
    name: "Trail",
    LOOK: 4.5,
    BACK: 2.4,
    tilt: Math.PI / 3,
    FOV: 60,
    D: 1.5,
    HEADF: 0.6,
    cam: 0,
    tree: { edges: [] },
    P: { x: 0, y: 0, dep: 1, k: 1 },
    stars: [],
    dust: [],
    sph: [],

    init() {
        this.stars = Array.from({ length: 190 }, () => ({
            x: Math.random(),
            y: Math.random(),
            s: rand(0.6, 1.7),
            p: Math.random() * TAU
        }));
        this.dust = Array.from({ length: 150 }, () => ({
            x: rand(-1.6, 1.6),
            t0: rand(0, 11),
            c: Math.random() < 0.5
        }));
        this.sph = Array.from({ length: 120 }, (_, i) => {
            const z = 1 - 2 * (i + 0.5) / 120;
            const radius = Math.sqrt(1 - z * z);
            const angle = i * 2.39996;
            return [radius * Math.cos(angle), radius * Math.sin(angle), z];
        });
        this.tree = { edges: [] };
        this.cam = 0;
    },

    layout(renderer) {
        this.S0 = Math.min(renderer.W * 0.34, renderer.H * 0.85);
        this.D = (0.5 * renderer.H / Math.tan(this.FOV * Math.PI / 360)) / this.S0;
        if (!renderer.score.trail) renderer.score.trail = buildTrail(renderer.score);
        this.tree = renderer.score.trail;
        this.cam = 0;
        this.setCam(renderer, 0);
    },

    setCam(renderer, worldY) {
        const theta = this.tilt;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const distance = this.D;
        const headOffset = (this.HEADF - 0.5) * renderer.H;
        const A = headOffset * distance / (this.S0 * distance * sin + headOffset * cos);
        this.ct = cos;
        this.st = sin;
        this.h = distance * sin;
        this.Yc = worldY + A - distance * cos;
    },

    pr(renderer, x, y, z = 0) {
        const dy = y - this.Yc;
        const height = this.h - z;
        const depth = dy * this.ct + height * this.st;
        const point = this.P;
        point.dep = depth;
        if (depth < this.D * 0.25) return false;
        const up = dy * this.st - height * this.ct;
        const scale = this.S0 * this.D / depth;
        point.k = scale;
        point.x = renderer.W / 2 + (x - this.cam) * scale;
        point.y = renderer.H * 0.5 - up * scale;
        return true;
    },

    block(renderer, wx, wy, size, rgb, alpha) {
        if (!this.pr(renderer, wx, wy)) return false;
        const context = renderer.ctx;
        const point = this.P;
        const scale = point.k;
        const width = size * scale;
        const front = size * scale * this.ct;
        const thickness = size * scale * this.st;
        const x = point.x;
        const y = point.y;
        if (x < -50 || x > renderer.W + 50 || y < -50 || y > renderer.H + 80) return false;
        context.fillStyle = `rgba(${rgb[0] * 0.5 | 0},${rgb[1] * 0.5 | 0},${rgb[2] * 0.5 | 0},${alpha})`;
        context.fillRect(x - width / 2, y + thickness / 2 - front, width, front);
        context.fillStyle = `rgba(${Math.min(255, rgb[0] * 1.05 + 40) | 0},${Math.min(255, rgb[1] * 1.05 + 40) | 0},${Math.min(255, rgb[2] * 1.05 + 40) | 0},${alpha})`;
        context.fillRect(x - width / 2, y - thickness / 2 - front, width, thickness);
        context.fillStyle = `rgba(255,255,255,${alpha * 0.35})`;
        context.fillRect(x - width / 2, y - thickness / 2 - front, width, Math.max(1, thickness * 0.2));
        return true;
    },

    burst(renderer, note, age, fog) {
        const life = 1.25 + Math.min(0.7, (note.end - note.start) * 0.3);
        if (age >= life) return;
        const velocity = note.vel / 127;
        const height = 0.05;
        if (!this.pr(renderer, note.wx, note.wy, height)) return;
        const point = this.P;
        const x = point.x;
        const y = point.y;
        const scale = point.k;
        if (x < -250 || x > renderer.W + 250 || y < -250 || y > renderer.H + 250) return;
        const normalized = age / life;
        const radius = 0.03 + 0.09 * velocity;
        const brightness = 0.2 + 0.8 * velocity;
        const ease = 1 - Math.exp(-age * 5.5);
        glow(renderer, note.ch, x, y, scale * radius * 3.4 * (0.5 + ease), (0.8 * Math.exp(-age * 4) + 0.12 * (1 - normalized)) * fog * brightness);
        const count = Math.round(14 + velocity * 32);
        const seed = (note.note * 131 + (note.start * 977 | 0)) % 1000 / 1000 * TAU;
        const cos = Math.cos(seed);
        const sin = Math.sin(seed);
        const twinkle = age * 24 | 0;
        const dot = Math.max(3, scale * (0.012 + 0.016 * velocity) * (1 - normalized * 0.5));
        const sprite = renderer.gaussSprites[note.ch & 15];
        renderer.ctx.globalAlpha = Math.min(1, (1 - normalized) ** 1.1 * fog * brightness);
        for (let i = 0; i < count; i++) {
            if ((i * 7 + twinkle) % 5 === 0) continue;
            const index = Math.floor(i * 120 / count);
            const sphere = this.sph[index];
            const dx = sphere[0] * cos - sphere[1] * sin;
            const dy = sphere[0] * sin + sphere[1] * cos;
            const currentRadius = radius * ease * (0.7 + 0.3 * ((index * 0.6180339) % 1));
            let z = height + sphere[2] * currentRadius - 0.12 * age * age;
            if (z < 0) z = 0;
            if (this.pr(renderer, note.wx + dx * currentRadius, note.wy + dy * currentRadius, z)) {
                renderer.ctx.drawImage(sprite, point.x - dot / 2, point.y - dot / 2, dot, dot);
            }
        }
        renderer.ctx.globalAlpha = 1;
    },

    drumBurst(renderer, note, wx, wy, age, fog) {
        const kind = drumKind(note.note);
        const life = kind === 4 ? 0.95 : kind === 0 ? 0.8 : 0.55;
        if (age >= life) return;
        const velocity = note.vel / 127;
        const rgb = DRUM_RGB[kind];
        const normalized = age / life;
        if (!this.pr(renderer, wx, wy, 0.03)) return;
        const point = this.P;
        const x = point.x;
        const y = point.y;
        const scale = point.k;
        if (x < -250 || x > renderer.W + 250 || y < -250 || y > renderer.H + 250) return;
        const size = [0.14, 0.10, 0.06, 0.10, 0.16][kind] * (0.7 + 0.5 * velocity);
        const ease = 1 - Math.exp(-age * 7);
        glow(renderer, DRUM_GLOW[kind], x, y, scale * size * (1.2 + 2.4 * (1 - Math.exp(-age * 9))), (1 - normalized) ** 1.6 * 0.95 * fog);
        if (this.pr(renderer, wx, wy, 0)) {
            const radius = size * 1.4 * ease * scale;
            const context = renderer.ctx;
            context.strokeStyle = `rgba(${rgb},${(1 - normalized) * 0.75 * fog})`;
            context.lineWidth = 1 + 2.5 * (1 - normalized);
            context.beginPath();
            context.ellipse(point.x, point.y, radius, radius * this.st, 0, 0, TAU);
            context.stroke();
        }
        const count = kind === 4 ? 18 : kind === 0 ? 10 : kind === 1 ? 14 : 8;
        const debrisSize = Math.max(1.5, scale * 0.009 * (1 - normalized * 0.5));
        const context = renderer.ctx;
        context.fillStyle = `rgba(${rgb},${(1 - normalized) * fog})`;
        for (let i = 0; i < count; i++) {
            const angle = i / count * TAU + note.note;
            const radius = size * (0.5 + 0.8 * ((i * 0.618) % 1)) * ease;
            const vz = 0.35 + 0.3 * ((i * 0.37) % 1);
            const z = 0.03 + vz * age - 0.9 * age * age;
            if (z < 0) continue;
            if (this.pr(renderer, wx + Math.cos(angle) * radius, wy + Math.sin(angle) * radius, z)) {
                context.fillRect(point.x - debrisSize / 2, point.y - debrisSize / 2, debrisSize, debrisSize);
            }
        }
    },

    draw(renderer, time, delta) {
        const context = renderer.ctx;
        const PAL = renderer.paletteRgb;
        const PALN = renderer.paletteRgbArray;
        const W = renderer.W;
        const H = renderer.H;
        const score = renderer.score;
        const notes = score.notes;
        const worldY = time * TRAIL_SPD;
        const energy = Math.min(2.5, renderer.energy);
        const maxTime = time + this.LOOK;
        const point = this.P;
        const lookWorldY = this.LOOK * TRAIL_SPD;

        let centerX = 0;
        let count = 0;
        for (let i = lb(notes, time - 0.5, note => note.start); i < notes.length && notes[i].start < time + 1.5 && count < 32; i++) {
            if (notes[i].ch !== 9) {
                centerX += trailX(notes[i].note, score);
                count++;
            }
        }
        this.cam += ((count ? centerX / count * 0.7 : 0) - this.cam) * Math.min(1, delta * 1.6);
        this.setCam(renderer, worldY);
        const fog = wy => {
            const age = wy - worldY;
            return age <= 0 ? 1 : Math.max(0, 1 - age / lookWorldY) ** 1.1;
        };

        context.globalCompositeOperation = "source-over";
        const background = context.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.8);
        background.addColorStop(0, "#0a1020");
        background.addColorStop(1, "#02030a");
        context.fillStyle = background;
        context.fillRect(0, 0, W, H);
        context.globalCompositeOperation = "lighter";

        for (const star of this.stars) {
            context.fillStyle = `rgba(210,220,255,${0.12 + 0.14 * Math.sin(time * 1.5 + star.p)})`;
            context.fillRect(star.x * W, star.y * H, star.s, star.s);
        }
        const cycle = this.LOOK + this.BACK;
        const railLength = 0.5 * W / this.S0 * 0.9;
        for (const dust of this.dust) {
            const wy = worldY + ((((dust.t0 - time) % cycle) + cycle) % cycle - this.BACK) * TRAIL_SPD;
            if (!this.pr(renderer, dust.x * railLength, wy)) continue;
            context.fillStyle = (dust.c ? "rgba(255,214,120," : "rgba(200,220,255,") + (fog(wy) * 0.5) + ")";
            const size = Math.max(1, point.k * 0.005);
            context.fillRect(point.x, point.y, size, size);
        }

        if (renderer.settings.showBarLines !== false && renderer.midiData) {
            for (const line of collectBarLines(renderer.midiData, time - this.BACK, this.LOOK + this.BACK)) {
                if (line.time < time - this.BACK || line.time >= maxTime) continue;
                const wy = line.time * TRAIL_SPD;
                if (!this.pr(renderer, this.cam, wy)) continue;
                const y = point.y;
                if (y < -10 || y > H + 10) continue;
                const down = line.kind === "bar";
                const alpha = fog(wy);
                context.fillStyle = `rgba(170,180,255,${alpha * (down ? 0.09 : 0.035)})`;
                context.fillRect(0, y, W, 1);
                context.fillStyle = `rgba(235,240,255,${alpha * (down ? 0.7 : 0.35)})`;
                for (const side of [-1, 1]) {
                    if (this.pr(renderer, side * 0.97, wy)) {
                        const size = (down ? 0.02 : 0.012) * point.k;
                        context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
                    }
                }
            }
        }

        context.lineCap = "round";
        context.lineJoin = "round";
        const edges = this.tree.edges;
        const span = TRAIL_BREAK + 2 * TRAIL_STEP + 0.05;
        let drawn = 0;
        for (let i = lb(edges, time - this.BACK, edge => edge.tb); i < edges.length && edges[i].tb - span <= time && drawn < 2500; i++) {
            const edge = edges[i];
            if (edge.ta > time) continue;
            const progress = Math.min(1, (time - edge.ta) / (edge.tb - edge.ta));
            const polyline = edge.poly || (edge.poly = trailPoly(edge.arcs));
            const target = progress * polyline.L;
            const points = polyline.pts;
            const cumulative = polyline.cum;
            let started = false;
            let headX = 0;
            let headY = 0;
            let headScale = 1;
            context.beginPath();
            for (let k = 0; k < cumulative.length; k++) {
                let x = points[2 * k];
                let y = points[2 * k + 1];
                let last = false;
                if (k > 0 && cumulative[k] > target) {
                    const u = (target - cumulative[k - 1]) / (cumulative[k] - cumulative[k - 1]);
                    x = points[2 * k - 2] + (x - points[2 * k - 2]) * u;
                    y = points[2 * k - 1] + (y - points[2 * k - 1]) * u;
                    last = true;
                }
                if (!this.pr(renderer, x, y)) {
                    started = false;
                } else {
                    if (started) context.lineTo(point.x, point.y);
                    else context.moveTo(point.x, point.y);
                    started = true;
                    headX = point.x;
                    headY = point.y;
                    headScale = point.k;
                }
                if (last) break;
            }
            drawn++;
            const alpha = 0.55 + 0.45 * edge.v / 127;
            const lineWidth = Math.max(1.2, Math.min(7, 0.0055 * headScale));
            context.strokeStyle = `rgba(${PAL[edge.ch]},${alpha * 0.14})`;
            context.lineWidth = lineWidth * 4.5;
            context.stroke();
            context.strokeStyle = `rgba(${PAL[edge.ch]},${alpha})`;
            context.lineWidth = lineWidth;
            context.stroke();
            if (progress < 1) {
                context.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
                context.lineWidth = lineWidth * 0.4;
                context.stroke();
                if (started) glow(renderer, edge.ch, headX, headY, 26 + lineWidth * 4, 0.9);
            }
        }
        context.lineWidth = 1;

        const firstIndex = lb(notes, time - this.BACK, note => note.start);
        let blockCount = 0;
        context.globalCompositeOperation = "source-over";
        for (let i = firstIndex; i < notes.length && notes[i].start < maxTime && blockCount < 2200; i++) {
            const note = notes[i];
            if (note.start <= time) continue;
            const wy = note.start * TRAIL_SPD;
            const alpha = fog(wy);
            const velocity = note.vel / 127;
            if (note.ch === 9) {
                const kind = drumKind(note.note);
                if (this.block(renderer, drumWX(note.note), wy, 0.04 + 0.025 * velocity, DRUM_RGB[kind], alpha)) blockCount++;
            } else if (this.block(renderer, note.wx, wy, 0.026 + 0.014 * velocity, PALN[note.ch], alpha)) {
                blockCount++;
            }
        }

        context.globalCompositeOperation = "lighter";
        let bursts = 0;
        for (let i = firstIndex; i < notes.length && notes[i].start < maxTime && bursts < 160; i++) {
            const note = notes[i];
            const age = time - note.start;
            const wy = note.start * TRAIL_SPD;
            const alpha = fog(wy);
            const drum = note.ch === 9;
            const wx = drum ? drumWX(note.note) : note.wx;
            if (age < 0) {
                if (!this.pr(renderer, wx, wy, 0.015)) continue;
                const arm = Math.max(0, 1 - (note.start - time) / 0.3);
                glow(
                    renderer,
                    drum ? DRUM_GLOW[drumKind(note.note)] : note.ch,
                    point.x,
                    point.y,
                    point.k * 0.1,
                    alpha * (0.28 + 0.6 * arm)
                );
            } else {
                bursts++;
                if (drum) {
                    this.drumBurst(renderer, note, wx, wy, age, 1);
                } else {
                    this.burst(renderer, note, age, 1);
                    if (note.end > time && this.pr(renderer, wx, wy)) {
                        glow(renderer, note.ch, point.x, point.y, point.k * 0.05, 0.5);
                    }
                }
            }
        }
        context.lineWidth = 1;
    }
};

const MODES = { cascade: Cascade, orbit: Orbit, warp: Warp, trail: Trail };

function resolveModeName(settings) {
    const direct = String(settings.neoMode || "").replace(/^neo-/, "");
    if (MODES[direct]) return direct;
    const rendererMode = String(settings.rendererMode || "").replace(/^neo-/, "");
    return MODES[rendererMode] ? rendererMode : "cascade";
}

export function isNeoRendererMode(mode) {
    return /^neo(?:-|$)/.test(String(mode || ""));
}

export class NeoRenderer {
    constructor(canvas, settings = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.settings = Object.assign({
            spanDuration: 4,
            maxNoteDuration: 30,
            showBarLines: true,
            neoLegacyPalette: false,
            rendererMode: "neo-cascade"
        }, settings);
        this._updatePalette();
        this.midiData = null;
        this.score = buildScore(null, this.settings);
        this.activeNotes = [];
        this.noteIndex = 0;
        this.energy = 0;
        this.playing = false;
        this.particles = [];
        this.W = 1;
        this.H = 1;
        this.dpr = 1;
        this._lastPlayTime = null;
        this._lastFrameTime = performance.now();
        this._modeName = resolveModeName(this.settings);
        this._mode = MODES[this._modeName];
        this._mode.init(this);
    }

    updateSettings(settings) {
        const oldMaxDuration = this.settings.maxNoteDuration;
        const oldLegacyPalette = this.settings.neoLegacyPalette;
        Object.assign(this.settings, settings);
        if (oldLegacyPalette !== this.settings.neoLegacyPalette) {
            this._updatePalette();
        }
        const nextMode = resolveModeName(this.settings);
        if (nextMode !== this._modeName) {
            this._modeName = nextMode;
            this._mode = MODES[nextMode];
            this.particles.length = 0;
            this._mode.init(this);
        }
        if (this.midiData && oldMaxDuration !== this.settings.maxNoteDuration) {
            this.score = buildScore(this.midiData, this.settings);
            this.noteIndex = 0;
            this.activeNotes = [];
        }
        this._mode.layout(this);
    }

    _updatePalette() {
        const legacy = !!this.settings.neoLegacyPalette;
        this.paletteRgb = legacy ? LEGACY_PAL : PAL;
        this.paletteRgbArray = legacy ? LEGACY_PALN : PALN;
        this.glowSprites = legacy ? LEGACY_GLOW : NEO_GLOW;
        this.gaussSprites = legacy ? LEGACY_GAUSS : NEO_GAUSS;
    }

    setMidiData(midiData) {
        this.midiData = midiData;
        this.score = buildScore(midiData, this.settings);
        this.particles.length = 0;
        this.energy = 0;
        this._resync(0);
        this._mode.layout(this);
    }

    detectSize() {
        const rect = this.canvas.getBoundingClientRect();
        return {
            w: Math.max(1, rect.width || this.canvas.width || 1),
            h: Math.max(1, rect.height || this.canvas.height || 1)
        };
    }

    resize() {
        const size = this.detectSize();
        const offscreen = typeof OffscreenCanvas !== "undefined" && this.canvas instanceof OffscreenCanvas;
        this.dpr = offscreen ? 1 : Math.min(window.devicePixelRatio || 1, 2);
        const pixelWidth = Math.max(1, Math.round(size.w * this.dpr));
        const pixelHeight = Math.max(1, Math.round(size.h * this.dpr));
        if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
        if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
        this.W = size.w;
        this.H = size.h;
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this._mode.layout(this);
        this.renderFrame(this._lastPlayTime == null ? 0 : this._lastPlayTime);
    }

    _resync(time) {
        const notes = this.score.notes;
        this.noteIndex = lb(notes, time, note => note.start);
        this.activeNotes = [];
        for (let i = lb(notes, time - this.score.maxDur - 0.01, note => note.start); i < this.noteIndex; i++) {
            if (notes[i].end > time) this.activeNotes.push(notes[i]);
        }
        this._lastPlayTime = time;
        if (this._mode.onSeek) this._mode.onSeek(this, time);
    }

    spawn(x, y, vx, vy, life, channel, size, gravity = 0, drag = 0.98) {
        if (this.particles.length > 3500) return;
        this.particles.push({
            x,
            y,
            vx,
            vy,
            life,
            max: life,
            ch: channel,
            size,
            grav: gravity,
            drag
        });
    }

    stepParticles(delta) {
        const context = this.ctx;
        context.globalCompositeOperation = "lighter";
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.life -= delta;
            if (particle.life <= 0) {
                this.particles[i] = this.particles[this.particles.length - 1];
                this.particles.pop();
                continue;
            }
            const damping = particle.drag ** (delta * 60);
            particle.vx *= damping;
            particle.vy *= damping;
            particle.vy += particle.grav * delta;
            particle.x += particle.vx * delta;
            particle.y += particle.vy * delta;
            const alpha = particle.life / particle.max;
            glow(
                this,
                particle.ch,
                particle.x,
                particle.y,
                particle.size * (0.4 + 0.6 * alpha),
                alpha
            );
        }
    }

    renderFrame(playTime) {
        if (!Number.isFinite(playTime)) return;
        const time = Math.max(0, playTime);
        const now = performance.now();
        const fixedDelta = Number(this.settings.fixedDeltaTime);
        const delta = Number.isFinite(fixedDelta)
            ? fixedDelta
            : Math.min(0.05, Math.max(0, (now - this._lastFrameTime) / 1000));
        this._lastFrameTime = now;

        const previous = this._lastPlayTime;
        this.playing = previous != null && time > previous + 1e-9;
        if (previous == null || time < previous - 0.001 || time - previous > 1) {
            this._resync(time);
        }

        const notes = this.score.notes;
        while (this.noteIndex < notes.length && notes[this.noteIndex].start <= time) {
            const note = notes[this.noteIndex++];
            if (note.end > time) {
                this.activeNotes.push(note);
                this.energy += note.vel / 127 * 0.09;
                if (this._mode.hit) this._mode.hit(this, note, time);
            }
        }
        this.activeNotes = this.activeNotes.filter(note => note.end > time);
        this._lastPlayTime = time;
        this.energy *= Math.exp(-delta * 1.6);

        const context = this.ctx;
        context.save();
        context.globalAlpha = 1;
        context.shadowBlur = 0;
        this._mode.draw(this, time, delta);
        context.restore();
    }

    dispose() {
        this.particles.length = 0;
        this.activeNotes = [];
    }
}
