
import { $ } from "../utils";
import LyricsRoll from "../lrc-roll";

const waterfall = $("#waterfall");
const canvas = waterfall.querySelector('canvas');
const dpr = window.devicePixelRatio;
import * as THREE from 'three';

let fillColor = 'white';

export const palette = [
    '#f44336', '#ff9800', '#ffc107', '#ffeb3b',
    '#cddc39', '#8bc34a', '#4caf50', '#009688',
    '#00bcd4', '#9e9e9e', '#03a9f4', '#2196f3',
    '#3f51b5', '#673ab7', '#9c27b0', '#e91e63'
]

const bwr = 12 / 7; // White key = n black key
const maxNoteDuration = 30;

// 定义一个包含所有黑键的数组
const blackKeys = [1, 3, 6, 8, 10];
// 定义一个数组，包含所有白键的音符名称的编号
const whiteKeyNumbers = [0, 2, 4, 5, 7, 9, 11];

function isBlackKey(midiNoteNumber) {
    const noteNameNumber = midiNoteNumber % 12;
    return blackKeys.includes(noteNameNumber);
}

function getWhiteKeyNumber(midiNoteNumber) {
    const noteNameNumber = midiNoteNumber % 12;
    const mul = parseInt(midiNoteNumber / 12);
    return whiteKeyNumbers.indexOf(noteNameNumber) + mul * 7;
}

function getStopTime(note, settings) {
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
    if (!list || list.length == 0) return {
        notes: [],
        index: 0
    };
    let left = 0;
    let right = list.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (list[mid].startTime <= startTime) {
            left = mid + 1;
        } else {
            right = mid - 1;
        }
    }

    const result = [];
    let i = left;

    while (i < list.length && list[i].startTime < startTime + duration) {
        result.push(list[i]);
        i++;
    }

    i = left - 1;
    while (i >= 0) {
        let note = list[i];
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

function getY(time, playTime, scaling) {
    return (time - playTime) * scaling;
}

export class MidiFall {
    constructor(canvas, settings = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.settings = Object.assign({
            spanDuration: 4,
            maxNoteDuration: 30,
            noteTransparency: false,
            highlightNotes: true,
            detailedNotes: false,
            prefmon: false,
            showLyrics: true
        }, settings);

        this.midiData = null;
        this.noteWidth = 0;
        this.keyboardHeight = 0;
        this.blackKeyHeight = 0;
        this.notesState = Array(128);
        this.dpr = window.devicePixelRatio || 1;

        // Performance monitoring
        this.lastDrawTime = performance.now();
        this.timeList = [];
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
    }

    setMidiData(midiData) {
        this.midiData = midiData;
    }

    resize() {
        let {
            width: cssWidth,
            height: cssHeight
        } = this.canvas.getBoundingClientRect();

        this.dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.dpr * cssWidth;
        this.canvas.height = this.dpr * cssHeight;

        this.noteWidth = this.canvas.width / 128;
        this.keyboardHeight = this.noteWidth * 9;
        this.blackKeyHeight = this.noteWidth * 5.5;
        this.renderFrame(this.lastTime ?? 0)
    }

    renderFrame(playTime) {
        const {
            width,
            height
        } = this.canvas;
        const ctx = this.ctx;
        const settings = this.settings;
        this.lastTime = playTime;

        ctx.globalCompositeOperation = 'copy';
        if (settings.backgroundColor) {
            ctx.fillStyle = settings.backgroundColor;
        } else {
            ctx.fillStyle = "#ff000000";
        }
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';

        let scaling = height / settings.spanDuration;
        let noteCount = 0;
        let renderCount = 0;

        if (this.midiData != null) {
            for (let i = 0; i < 16; i++) {
                ctx.fillStyle = palette[i];
                ctx.strokeStyle = palette[i];

                // Ensure channels exist and have notes
                if (!this.midiData.channels[i]) continue;

                let result = fastSpan(this.midiData.channels[i].notes, playTime, settings.spanDuration);
                noteCount += result.index;
                renderCount += result.notes.length;

                for (let note of result.notes) {
                    let stopTime = getStopTime(note, settings);
                    let startY = getY(note.startTime, playTime, scaling);
                    let endY = getY(stopTime, playTime, scaling)

                    let black = isBlackKey(note.pitch);
                    let thisNoteWidth = black ? this.noteWidth : this.noteWidth * bwr;
                    let noteIndex = black ? note.pitch : getWhiteKeyNumber(note.pitch)
                    let x = noteIndex * thisNoteWidth;

                    if (settings.noteTransparency) {
                        ctx.fillStyle = palette[i] + getNoteTransparency(note.velocity);
                    }
                    if (stopTime > playTime) {
                        if (!settings.detailedNotes) {
                            let y = height - endY - this.keyboardHeight;
                            let dx = thisNoteWidth;
                            let dy = endY - startY;
                            ctx.fillRect(x, y, dx, dy);
                        }

                        // Pressed key
                        if (note.startTime < playTime) {
                            this.notesState[note.pitch] = i;

                            // Highlight notes
                            if (settings.highlightNotes && !settings.detailedNotes) {
                                let played = playTime - note.startTime;
                                let noteDuration = stopTime - note.startTime;
                                let transparency = Math.max(
                                    Math.min(
                                        1 - (played / noteDuration)
                                        , 1), 0
                                );
                                ctx.shadowOffsetX = 0;
                                ctx.shadowOffsetY = 0;
                                ctx.shadowBlur = thisNoteWidth * 5 * transparency;
                                ctx.shadowColor = palette[i];

                                let extraWidth = thisNoteWidth * (transparency + 1)

                                ctx.fillRect(x + thisNoteWidth * 0.5 - extraWidth * 0.5, height - endY - this.keyboardHeight, extraWidth, endY - startY);
                                ctx.fillStyle = palette[i];

                                ctx.shadowOffsetX = 0;
                                ctx.shadowOffsetY = 0;
                                ctx.shadowBlur = 0;
                                ctx.shadowColor = "transparent";
                            }
                        }
                    }

                    if (settings.detailedNotes) {
                        ctx.lineWidth = 2;
                        ctx.blendMode = 'multiply';
                        const noteStartY = height - startY - this.keyboardHeight;
                        const noteEndY = height - endY - this.keyboardHeight;

                        // Draw sustain pedal line
                        if (note.holdBeforeStop && note.holdBeforeStop.length > 0) {
                            const endY2 = height - getY(note.stopTime, playTime, scaling) - this.keyboardHeight;
                            ctx.beginPath();
                            ctx.moveTo(x + this.noteWidth * 0.5, noteEndY);
                            ctx.lineTo(x + this.noteWidth * 0.5, endY2);
                            ctx.moveTo(x, endY2);
                            ctx.lineTo(x + this.noteWidth, endY2);
                            ctx.stroke();
                        }

                        const controls = [
                            ...note.pitchBend.map(e => ({ t: 0, e: e })),
                            ...note.expression.map(e => ({ t: 1, e: e })),
                        ].sort((e1, e2) => e1.e.time - e2.e.time)

                        let centerX = x;
                        let width = this.noteWidth;
                        let yRecord = [];
                        ctx.beginPath();
                        ctx.moveTo(centerX, noteStartY);
                        ctx.lineTo(centerX + this.noteWidth, noteStartY);
                        controls.forEach(control => {
                            switch (control.t) {
                                case 0: // pitch bend
                                    centerX = x + control.e.value * this.noteWidth;
                                    break
                                case 1: // expression
                                    width = control.e.value / 127 * this.noteWidth;
                                    break
                            }
                            let currentY = height - getY(control.e.time, playTime, scaling) - this.keyboardHeight;
                            ctx.lineTo(centerX + width, currentY);
                            yRecord.push([centerX, currentY])
                        });
                        ctx.lineTo(centerX + width, noteEndY);
                        ctx.lineTo(centerX, noteEndY);
                        yRecord.reverse().forEach(xy => {
                            ctx.lineTo(xy[0], xy[1]);
                        });

                        ctx.closePath();
                        ctx.fill();
                        if (note.startTime < playTime && stopTime > playTime && settings.highlightNotes) {
                            ctx.fillStyle = '#ffffff60';
                            ctx.fill();
                            ctx.fillStyle = palette[i];
                        }
                    }
                }
            }
        }

        // Draw white keys
        ctx.fillStyle = 'white';
        ctx.fillRect(0, height - this.keyboardHeight, width, this.keyboardHeight);

        ctx.fillStyle = 'gray';
        for (let i = 0; i < 128; i++) {
            if (!isBlackKey(i)) {
                let x = getWhiteKeyNumber(i) * bwr;
                if (this.notesState[i] != null) {
                    ctx.fillStyle = palette[this.notesState[i]];
                    ctx.fillRect(this.noteWidth * x, height - this.keyboardHeight, this.noteWidth * bwr, this.keyboardHeight);
                    ctx.fillStyle = 'gray';
                    this.notesState[i] = null;
                }

                ctx.fillRect(this.noteWidth * x, height - this.keyboardHeight, 1, this.keyboardHeight); // Draw Seam
            }
        }

        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = this.noteWidth * 0.75;
        ctx.shadowColor = "#00000080";

        ctx.fillStyle = '#b71c1c';
        ctx.fillRect(0, height - this.keyboardHeight - this.noteWidth * 0.5, width, this.noteWidth * 0.5);

        // Draw black keys
        ctx.fillStyle = 'black';
        for (let i = 0; i < 128; i++) {
            if (isBlackKey(i)) {
                if (this.notesState[i] != null) {
                    ctx.fillStyle = palette[this.notesState[i]];
                    this.notesState[i] = null;
                }
                ctx.fillRect(i * this.noteWidth, height - this.keyboardHeight, this.noteWidth, this.blackKeyHeight);
                ctx.fillStyle = 'black';
            }
        }

        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = 0;
        ctx.shadowColor = "transparent";

        if (settings.prefmon) {
            this.drawPerfMon(renderCount, noteCount);
        }
    }

    drawPerfMon(renderCount, noteCount) {
        const ctx = this.ctx;
        let drawTime = performance.now();
        let frameTime = drawTime - this.lastDrawTime;

        this.lastDrawTime = drawTime;
        this.timeList.push(frameTime);
        if (this.timeList.length > 250) {
            this.timeList.shift();
        }

        let c = 0;
        let t = 0
        for (let i = this.timeList.length - 1; i > 0; i--) {
            t += this.timeList[i];
            c++;
            if (t > 1000) {
                break;
            }
        }

        ctx.fillStyle = '#00000080';
        ctx.fillRect(0, 0, 260, 160);

        ctx.fillStyle = "white";
        ctx.font = "26px Sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";

        ctx.fillText(`N: ${noteCount} R: ${renderCount}`, 0, 0);
        ctx.fillText(`T: ${frameTime.toFixed(1)}  ${(c / t * 1000).toFixed(2)}fps`, 0, 26);


        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.strokeStyle = "red";
        ctx.moveTo(0, 150);
        ctx.lineTo(250, 150);
        ctx.stroke();

        ctx.strokeStyle = "#ffffff80";
        for (let i = 0; i < 100; i += 20) {
            ctx.beginPath();
            ctx.moveTo(0, 150 - i);
            ctx.lineTo(250, 150 - i);
            ctx.stroke();
        }

        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "white";
        ctx.beginPath();
        ctx.moveTo(0, 150 - frameTime);
        for (let i = 0; i < this.timeList.length; i++) {
            ctx.lineTo(i, 150 - this.timeList[i]);
        }
        ctx.stroke();
    }
}


export class WebGLRenderer {
    constructor(canvas, settings = {}) {
        this.canvas = canvas;
        this.settings = Object.assign({
            spanDuration: 4,
            maxNoteDuration: 30,
            noteTransparency: false,
            highlightNotes: true,
            detailedNotes: false,
            prefmon: false,
            showLyrics: true
        }, settings);

        this.midiData = null;
        this.lastDrawTime = performance.now();
        this.lastTime = 0;
        this.timeList = [];
        this.dpr = window.devicePixelRatio || 1;

        // ── THREE.js core ──
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
        this.renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: false
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = false;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // ── Fog for depth ──
        this.scene.fog = new THREE.FogExp2(0x050510, 0.008);
        this.scene.background = new THREE.Color(0x050510);

        // ── Lights ──
        const ambient = new THREE.AmbientLight(0x222244, 0.6);
        this.scene.add(ambient);

        this.pointLight = new THREE.PointLight(0xffffff, 1.2, 200);
        this.pointLight.position.set(0, 20, 0);
        this.scene.add(this.pointLight);

        const dirLight = new THREE.DirectionalLight(0x8888ff, 0.4);
        dirLight.position.set(-30, 40, -20);
        this.scene.add(dirLight);

        // ── Shared geometries ──
        this.noteGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.noteGeometry.translate(0, 0.5, 0.5); // pivot at bottom-back

        // ── Materials per channel (neon glow) ──
        this.noteMaterials = palette.map(color => new THREE.MeshStandardMaterial({
            color: color,
            emissive: new THREE.Color(color),
            emissiveIntensity: 0.35,
            metalness: 0.3,
            roughness: 0.5,
            transparent: true,
            opacity: 0.92
        }));
        this.activeNoteMaterials = palette.map(color => new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: new THREE.Color(color),
            emissiveIntensity: 1.8,
            metalness: 0.1,
            roughness: 0.2,
            transparent: true,
            opacity: 1.0
        }));

        // ── Ground plane (reflective dark stage) ──
        const groundGeo = new THREE.PlaneGeometry(200, 600);
        const groundMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a1a,
            metalness: 0.85,
            roughness: 0.15,
            envMapIntensity: 0.5
        });
        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.5;
        this.scene.add(this.ground);

        // ── Grid overlay ──
        const gridHelper = new THREE.GridHelper(200, 128, 0x1a1a3a, 0x0d0d20);
        gridHelper.position.y = -0.48;
        this.scene.add(gridHelper);

        // ── Playline (glowing cylinder) ──
        const playlineMat = new THREE.MeshStandardMaterial({
            color: 0xff2244,
            emissive: 0xff2244,
            emissiveIntensity: 2.5,
            metalness: 0.0,
            roughness: 0.3,
            transparent: true,
            opacity: 0.9
        });
        const playlineGeo = new THREE.CylinderGeometry(0.25, 0.25, 130, 8);
        playlineGeo.rotateZ(Math.PI / 2);
        this.playline = new THREE.Mesh(playlineGeo, playlineMat);
        this.playline.position.y = 0.3;
        this.scene.add(this.playline);

        // ── Side rail glow lines ──
        const railMat = new THREE.MeshStandardMaterial({
            color: 0x4444ff,
            emissive: 0x4444ff,
            emissiveIntensity: 1.0,
            transparent: true,
            opacity: 0.5
        });
        const railGeo = new THREE.BoxGeometry(0.15, 0.5, 600);
        const leftRail = new THREE.Mesh(railGeo, railMat);
        leftRail.position.set(-65, 0, 0);
        this.scene.add(leftRail);
        const rightRail = new THREE.Mesh(railGeo, railMat);
        rightRail.position.set(65, 0, 0);
        this.scene.add(rightRail);

        // ── Particle system for note hits ──
        this._particleCount = 512;
        this._particlePositions = new Float32Array(this._particleCount * 3);
        this._particleColors = new Float32Array(this._particleCount * 3);
        this._particleVelocities = new Float32Array(this._particleCount * 3);
        this._particleLifetimes = new Float32Array(this._particleCount);
        this._particleIndex = 0;

        const particleGeo = new THREE.BufferGeometry();
        particleGeo.setAttribute('position', new THREE.BufferAttribute(this._particlePositions, 3));
        particleGeo.setAttribute('color', new THREE.BufferAttribute(this._particleColors, 3));

        // Procedural circle texture
        const pCanvas = document.createElement('canvas');
        pCanvas.width = 32;
        pCanvas.height = 32;
        const pCtx = pCanvas.getContext('2d');
        const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        pCtx.fillStyle = grad;
        pCtx.fillRect(0, 0, 32, 32);
        const particleTexture = new THREE.CanvasTexture(pCanvas);

        const particleMat = new THREE.PointsMaterial({
            size: 1.2,
            map: particleTexture,
            vertexColors: true,
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        this.particles = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particles);

        // ── Note mesh pool ──
        this._meshPool = [];
        this._meshPoolIndex = 0;

        // ── Track active note set for particle emission ──
        this._activeNotes = new Set();

        // Camera initial
        this.camera.position.set(0, 14, -20);
        this.camera.lookAt(0, 0, 20);
    }

    // ── MidiFall-compatible interface ──

    updateSettings(settings) {
        Object.assign(this.settings, settings);
    }

    setMidiData(midiData) {
        this.midiData = midiData;
    }

    resize() {
        const container = this.canvas.parentElement || waterfall;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;

        this.renderer.setSize(w, h);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderFrame(this.lastTime ?? 0);
    }

    renderFrame(playTime) {
        this.lastTime = playTime;
        const settings = this.settings;
        const zScale = 16; // seconds → world Z units

        const playZ = playTime * zScale;

        // ── Reset mesh pool ──
        this._meshPoolIndex = 0;

        // ── Move persistent scene objects ──
        this.ground.position.z = playZ + 100;
        this.playline.position.z = playZ;
        this.pointLight.position.set(0, 25, playZ);

        // ── Update particles ──
        this._updateParticles();

        // Track which notes are currently active this frame
        const nowActive = new Set();

        // ── Draw notes ──
        if (this.midiData != null) {
            for (let ch = 0; ch < 16; ch++) {
                if (!this.midiData.channels || !this.midiData.channels[ch]) continue;

                const result = fastSpan(this.midiData.channels[ch].notes, playTime, settings.spanDuration);

                for (const note of result.notes) {
                    const stopTime = getStopTime(note, settings);
                    if (stopTime <= playTime) continue;

                    const black = isBlackKey(note.pitch);
                    const noteWidth = black ? 0.6 : 0.9;
                    const noteHeight = black ? 0.7 : 0.5;
                    const x = -(note.pitch - 64);

                    const startZ = note.startTime * zScale;
                    const endZ = stopTime * zScale;
                    const noteLength = endZ - startZ;

                    const isPlaying = note.startTime < playTime;
                    const mat = isPlaying && settings.highlightNotes
                        ? this.activeNoteMaterials[ch]
                        : this.noteMaterials[ch];

                    const mesh = this._getMesh(mat);
                    mesh.scale.set(noteWidth, noteHeight, Math.max(noteLength, 0.3));
                    mesh.position.set(x, black ? 0.15 : 0, startZ);
                    mesh.visible = true;

                    // Particle emission for actively playing notes
                    if (isPlaying) {
                        const noteId = `${ch}-${note.pitch}-${note.startTime}`;
                        nowActive.add(noteId);
                        if (!this._activeNotes.has(noteId)) {
                            // Note just crossed playline → emit particles
                            this._emitParticles(x, noteHeight, playZ, ch);
                        }
                    }
                }
            }
        }

        this._activeNotes = nowActive;

        // Hide unused pooled meshes
        for (let i = this._meshPoolIndex; i < this._meshPool.length; i++) {
            this._meshPool[i].visible = false;
        }

        // ── Camera ──
        const camTargetX = 0;
        const camTargetY = 14;
        const camTargetZ = playZ - 18;

        this.camera.position.lerp(
            new THREE.Vector3(camTargetX, camTargetY, camTargetZ), 0.12
        );
        this.camera.lookAt(0, -2, playZ + 22);

        // ── Render ──
        this.renderer.render(this.scene, this.camera);

        // ── Perf mon ──
        if (settings.prefmon) {
            this._drawPerfMon();
        }
    }

    // ── Internal helpers ──

    _getMesh(material) {
        if (this._meshPoolIndex < this._meshPool.length) {
            const mesh = this._meshPool[this._meshPoolIndex];
            mesh.material = material;
            this._meshPoolIndex++;
            return mesh;
        }
        const mesh = new THREE.Mesh(this.noteGeometry, material);
        this._meshPool.push(mesh);
        this.scene.add(mesh);
        this._meshPoolIndex++;
        return mesh;
    }

    _emitParticles(x, y, z, channel) {
        const color = new THREE.Color(palette[channel]);
        const count = 6 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            const idx = this._particleIndex % this._particleCount;
            this._particlePositions[idx * 3] = x + (Math.random() - 0.5) * 0.5;
            this._particlePositions[idx * 3 + 1] = y + Math.random() * 0.5;
            this._particlePositions[idx * 3 + 2] = z + (Math.random() - 0.5) * 0.5;

            this._particleColors[idx * 3] = color.r;
            this._particleColors[idx * 3 + 1] = color.g;
            this._particleColors[idx * 3 + 2] = color.b;

            this._particleVelocities[idx * 3] = (Math.random() - 0.5) * 0.4;
            this._particleVelocities[idx * 3 + 1] = 0.2 + Math.random() * 0.5;
            this._particleVelocities[idx * 3 + 2] = (Math.random() - 0.5) * 0.4;

            this._particleLifetimes[idx] = 1.0;
            this._particleIndex++;
        }
    }

    _updateParticles() {
        const decay = 0.025;
        for (let i = 0; i < this._particleCount; i++) {
            if (this._particleLifetimes[i] > 0) {
                this._particleLifetimes[i] -= decay;
                this._particlePositions[i * 3] += this._particleVelocities[i * 3];
                this._particlePositions[i * 3 + 1] += this._particleVelocities[i * 3 + 1];
                this._particlePositions[i * 3 + 2] += this._particleVelocities[i * 3 + 2];
                // Gravity
                this._particleVelocities[i * 3 + 1] -= 0.012;
            } else {
                // Dead particle → hide far away
                this._particlePositions[i * 3 + 1] = -1000;
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
        this.particles.geometry.attributes.color.needsUpdate = true;
    }

    _drawPerfMon() {
        // Overlay perf stats using a 2D canvas overlay
        const now = performance.now();
        const frameTime = now - this.lastDrawTime;
        this.lastDrawTime = now;
        this.timeList.push(frameTime);
        if (this.timeList.length > 120) this.timeList.shift();

        // Use existing canvas 2D overlay if available; otherwise skip
        // WebGL renderer doesn't easily mix 2D — perf data logged to console
        const avgFrame = this.timeList.reduce((a, b) => a + b, 0) / this.timeList.length;
        const fps = 1000 / avgFrame;
        if (this.timeList.length % 60 === 0) {
            console.log(`[WebGL PerfMon] ${fps.toFixed(1)} fps, frame ${avgFrame.toFixed(1)}ms, pool ${this._meshPool.length}`);
        }
    }
}

export class MidiFallController {
    constructor(waterfallElement, midiFall, player) {
        this.waterfallElement = waterfallElement;
        this.midiFall = midiFall;
        this.player = player;
        this.animationId = null;
        this.wakeLock = null;
        this.wakeLockSupported = 'wakeLock' in navigator;

        // Lyrics support
        this.lrc = new LyricsRoll();
        this.lrcDiv = $("#lyrics");
        this.setupLyrics();

        // Bind resize
        this.resizeObserver = new ResizeObserver(entries => {
            this.midiFall.resize();
        });
        this.resizeObserver.observe(this.midiFall.canvas);
        window.addEventListener('resize', () => {
            this.midiFall.resize();
        });

        // Initial resize
        this.midiFall.resize();

        // Bind visibility change for wakelock
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === 'visible' && this.isVisible()) {
                this.acquireWakelock();
            }
        });
    }

    setupLyrics() {
        this.lrc.onload = (lyricsList) => {
            this.lrcDiv.innerText = '';
            if (lyricsList.length > 0) {
                for (let i = 0; i < lyricsList.length; i++) {
                    const lyrics = lyricsList[i];
                    let segment = document.createElement('span');
                    segment.id = 'lyrics-' + lyrics.ord;
                    segment.innerText = lyrics.text;
                    this.lrcDiv.appendChild(segment);
                }
            }
        }

        this.lrc.onlyrics = (lyrics) => {
            const lrcElement = document.getElementById('lyrics-' + lyrics.ord)
            if (lrcElement) {
                lrcElement.classList.add('lyrics-highlight');
                if (lrcElement.offsetWidth > 0) lrcElement.scrollIntoView({
                    block: "center",
                    behavior: 'smooth'
                })
            }
        }

        this.lrc.onseek = (lyrics) => {
            document.querySelectorAll('.lyrics-highlight').forEach(e => e.classList.remove('lyrics-highlight'));
            if (lyrics) {
                for (let i = 0; i <= lyrics.ord; i++) {
                    const el = document.getElementById('lyrics-' + i);
                    if (el) el.classList.add('lyrics-highlight');
                }
                const lrcElement = document.getElementById('lyrics-' + lyrics.ord)
                if (lrcElement) {
                    lrcElement.scrollIntoView({
                        block: "center",
                        behavior: 'smooth'
                    })
                }
            }
        }
    }

    setPlayer(player) {
        this.player = player;
    }

    setMidiData(playData) {
        this.midiFall.setMidiData(playData);
        if (playData) {
            this.lrc.load(playData);
        } else {
            this.lrc.clear();
            this.lrcDiv.innerText = '';
        }
    }

    updateSettings(settings) {
        this.midiFall.updateSettings(settings);
    }

    start() {
        if (this.animationId == null && this.isVisible()) {
            this.midiFall.lastDrawTime = performance.now();
            this.animationId = requestAnimationFrame(() => this.drawLoop());
        }
    }

    stop() {
        if (this.animationId != null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    drawLoop() {
        if (!this.isVisible()) {
            this.stop();
            return;
        }

        let currentTime = this.player ? this.player.currentTime : 0;
        this.midiFall.renderFrame(currentTime);

        if (this.midiFall.settings.showLyrics && this.player && !this.player.paused) {
            this.lrc.update(currentTime);
        }

        if (this.player && this.player.paused) {
            this.stop();
        } else {
            this.animationId = requestAnimationFrame(this.drawLoop.bind(this));
        }
    }

    isVisible() {
        return this.waterfallElement.classList.contains('open');
    }

    setVisible(value) {
        if (value) {
            this.waterfallElement.classList.remove('hidden');
            this.waterfallElement.classList.add('open');
            document.documentElement.classList.add('noscroll');

            this.waterfallElement.classList.add('open');
            document.documentElement.classList.add('noscroll');

            // Double resize to handle layout transitions
            this.midiFall.resize();

            this.start();
            this.acquireWakelock();
        } else {
            this.stop();
            this.waterfallElement.classList.add('hidden');
            this.waterfallElement.classList.remove('open');
            document.documentElement.classList.remove('noscroll');
            if (this.wakeLockSupported && this.wakeLock != null) {
                this.wakeLock.release()
                    .then(() => {
                        this.wakeLock = null;
                    });
            }
        }
    }

    toggle() {
        this.setVisible(!this.isVisible());
    }

    setLyricsVisible(visible) {
        if (visible) {
            // Reload lyrics if data exists (handled in setMidiData or check existing)
            // For now assume lrc object manages its state, we just ensure it updates
        } else {
            this.lrc.clear(); // Or just hide? logic was clear() before
            this.lrcDiv.innerText = '';
            // we really should reload if enabled again, 
            // but the original logic relied on loading from picoAudio.playData
        }
    }

    acquireWakelock() {
        if (this.wakeLockSupported) {
            try {
                navigator.wakeLock.request('screen').then(lock => {
                    this.wakeLock = lock;
                    lock.addEventListener('release', e => {
                        console.log("wakelock released");
                    })
                });
            } catch (error) {
                console.error(error);
            }
        }
    }
}