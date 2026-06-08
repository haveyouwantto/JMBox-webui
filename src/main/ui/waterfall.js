
import { $ } from "../utils";
import LyricsRoll from "../lrc-roll";

const waterfall = $("#waterfall");
const canvas = waterfall.querySelector('canvas');
const dpr = window.devicePixelRatio;
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

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
            showLyrics: true,
            // ── 音符独立 Bloom 参数 ──
            noteDecay: 1.0,
            noteBloomBase: 10,
            noteBloomIdle: 0.5,
            noteBloomMin: 1,
            // ── 播放线独立 Bloom 参数 ──
            playlineDecay: 2.5,
            playlineBaseEmissive: 0.25,
            playlineBoostMultiplier: 2.8,
            // ── 星星独立 Bloom 参数（新） ──
            starDecay: 16.0,
            starBloomBase: 15.0,        // note-on 瞬间 emissive 强度
            starBloomMin: 0.15,        // 最暗时的 emissive 强度
            starCount: 2000,
            starSize: 0.2,             // 星星面片大小
            starColorDim: '#1a3355',   // 暗态基础色
            starColorBright: '#88bbff', // 亮态 emissive 色

            cameraYOffsetLandscape: 40,   // 横屏时的摄像机高度
            cameraYOffsetPortrait: 70,    // 竖屏时的摄像机高度（越大越垂直）

            cameraZOffsetLandscape: 40,
            cameraZOffsetPortrait: -10,
            cameraLookAheadLandscape: 30,
            cameraLookAheadPortrait: 70,
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
        this.renderer.toneMappingExposure = 1.35;

        this.renderPass = new RenderPass(this.scene, this.camera);
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.55, 0);
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(this.renderPass);
        this.composer.addPass(this.bloomPass);

        this.trackWidth = 136;
        this.channelLaneStep = 0.18;
        this.channelLaneBase = 0.05;
        this.cameraYOffset = 46;
        this.cameraZOffset = 43;
        this.cameraLookAhead = 50;
        this.webglSpanDuration = 15;
        this._lastFrameTime = performance.now();

        // ── Fog ──
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

        // ── Shared geometry ──
        this.noteGeometry = new THREE.BoxGeometry(1, 1, 1);
        this.noteGeometry.translate(0, 0.5, 0.5);

        // ── 调色板 ──
        this.palette = palette;

        // ── Grid ──
        this.gridHelper = new THREE.GridHelper(220, 128, 0x1a1a3a, 0x0d0d20);
        this.gridHelper.position.y = -0.48;
        this.scene.add(this.gridHelper);

        // ── Playline ──
        const playlineMat = new THREE.MeshStandardMaterial({
            color: 0xff2244,
            emissive: 0xff2244,
            emissiveIntensity: this.settings.playlineBaseEmissive,
            metalness: 0.0,
            roughness: 0.3,
            transparent: true,
            opacity: 0.9
        });
        const playlineGeo = new THREE.CylinderGeometry(0.25, 0.25, this.trackWidth, 8);
        playlineGeo.rotateZ(Math.PI / 2);
        this.playline = new THREE.Mesh(playlineGeo, playlineMat);
        this.playline.position.y = 0.3;
        this.scene.add(this.playline);

        // ── Side rails ──
        const railMat = new THREE.MeshStandardMaterial({
            color: 0x4444ff,
            emissive: 0x4444ff,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.5
        });
        const railGeo = new THREE.BoxGeometry(0.15, 0.5, 600);
        this.leftRail = new THREE.Mesh(railGeo, railMat);
        this.leftRail.position.set(-65, 0, 0);
        this.scene.add(this.leftRail);
        this.rightRail = new THREE.Mesh(railGeo, railMat);
        this.rightRail.position.set(65, 0, 0);
        this.scene.add(this.rightRail);

        // ── Particle effects ──
        this.popDotTexture = this._createPopTexture('dot');
        this.popRingTexture = this._createPopTexture('ring');
        this._popEffects = [];
        this._popPool = [];

        // ── Note mesh & material pools ──
        this._meshPool = [];
        this._meshPoolIndex = 0;
        this._noteMaterialMap = new Map();
        this._materialPool = [];

        // ── Active notes tracking ──
        this._activeNotes = new Set();

        // ── 独立 boost 值：星星 & 播放线 ──
        this._starBoost = 0;
        this._playlineBoost = 0;

        // ── 背景星星（InstancedMesh + emissive → 支持 Bloom） ──
        this._initStars();

        // Camera initial
        this.camera.position.set(0, this.cameraYOffset, -this.cameraZOffset);
        this.camera.lookAt(0, 1, this.cameraLookAhead);
    }

    /**
     * 初始化星星：使用 InstancedMesh 使每个星星拥有 emissive，从而能被 Bloom 捕获。
     * 材质统一控制 emissiveIntensity，每个实例通过矩阵定位。
     */
    _initStars() {
        const count = this.settings.starCount;
        const starGeo = new THREE.PlaneGeometry(this.settings.starSize, this.settings.starSize);

        this.starMaterial = new THREE.MeshStandardMaterial({
            color: this.settings.starColorDim,
            emissive: new THREE.Color(this.settings.starColorBright),
            emissiveIntensity: 0,
            side: THREE.DoubleSide,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starInstancedMesh = new THREE.InstancedMesh(starGeo, this.starMaterial, count);
        this.starInstancedMesh.frustumCulled = false;

        // 存储每个星星的绝对世界坐标（x, y, z）
        this._starWorld = new Float32Array(count * 3);
        const dummy = new THREE.Object3D();
        for (let i = 0; i < count; i++) {
            // 扩大分布范围：x 向左右延伸，y 从很低到很高，z 保持前后长距离覆盖
            const x = (Math.random() - 0.5) * 400;        // -200 ~ 200
            const y = -100 + Math.random() * 200;          // -100 ~ 100 (涵盖地下、轨道及高空)
            const z = -300 + Math.random() * 800;         // -300 ~ 500 (更宽广的纵深)
            this._starWorld[i * 3] = x;
            this._starWorld[i * 3 + 1] = y;
            this._starWorld[i * 3 + 2] = z;

            dummy.position.set(x, y, z);
            dummy.updateMatrix();
            this.starInstancedMesh.setMatrixAt(i, dummy.matrix);
        }
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;
        this.scene.add(this.starInstancedMesh);
    }

    // ── MidiFall interface ──
    updateSettings(settings) {
        Object.assign(this.settings, settings);
        // 动态更新星星颜色
        if (this.starMaterial) {
            this.starMaterial.color.set(this.settings.starColorDim);
            this.starMaterial.emissive.set(this.settings.starColorBright);
            this.starMaterial.emissiveIntensity = 0;
        }
    }

    setMidiData(midiData) { this.midiData = midiData; }

    resize() {
        const container = this.canvas.parentElement || waterfall;
        const rect = container.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width));
        const h = Math.max(1, Math.round(rect.height));
        if (w === 0 || h === 0) return;

        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(w, h, false);
        this.composer.setSize(w, h);
        this.camera.aspect = w / h;

        // 根据宽高比插值摄像机高度：竖屏→更高（垂直），横屏→更低（平视）
        const aspect = this.camera.aspect;
        const landscapeAspect = 1.4;     // 横屏阈值
        const portraitAspect = 0.7;      // 竖屏阈值
        const yLandscape = this.settings.cameraYOffsetLandscape;
        const yPortrait = this.settings.cameraYOffsetPortrait;
        let t;
        if (aspect >= landscapeAspect) {
            t = 1;
        } else if (aspect <= portraitAspect) {
            t = 0;
        } else {
            t = (aspect - portraitAspect) / (landscapeAspect - portraitAspect);
        }
        this.cameraYOffset = yLandscape * t + yPortrait * (1 - t);

        // 🆕 同步调整摄像机前后距离
        this.cameraZOffset = this.settings.cameraZOffsetLandscape * t +
            this.settings.cameraZOffsetPortrait * (1 - t);
        // 🆕 同步调整摄像机前瞻距离
        this.cameraLookAhead = this.settings.cameraLookAheadLandscape * t +
            this.settings.cameraLookAheadPortrait * (1 - t);

        this._fitCameraToDisplayWidth();  // 内部已使用最新的 cameraYOffset 计算 FOV
        this.camera.updateProjectionMatrix();
        this.renderFrame(this.lastTime ?? 0);
    }

    renderFrame(playTime) {
        this.lastTime = playTime;
        const s = this.settings;
        const now = performance.now();
        const deltaTime = Math.min((now - this._lastFrameTime) / 1000, 0.05);
        this._lastFrameTime = now;
        const zScale = 16;
        const playZ = playTime * zScale;

        // ★ 独立衰减：星星 & 播放线
        this._starBoost *= Math.exp(-s.starDecay * deltaTime);
        this._playlineBoost *= Math.exp(-s.playlineDecay * deltaTime);

        // ── 清理过期音符材质 ──
        this._cleanExpiredNotes(playTime);

        // ── 重置 mesh 池索引 ──
        this._meshPoolIndex = 0;

        // ── 移动持久物体 ──
        this.gridHelper.position.z = playZ;
        this.leftRail.position.z = playZ;
        this.rightRail.position.z = playZ;
        this.playline.position.z = playZ;
        this.pointLight.position.set(0, 25, playZ);

        // ── 更新粒子特效 ──
        this._updatePopEffects(deltaTime);

        const nowActive = new Set();

        // ── 绘制音符 ──
        if (this.midiData != null) {
            for (let ch = 0; ch < 16; ch++) {
                if (!this.midiData.channels || !this.midiData.channels[ch]) continue;

                const result = fastSpan(
                    this.midiData.channels[ch].notes,
                    playTime,
                    Math.max(s.spanDuration, this.webglSpanDuration)
                );

                for (const note of result.notes) {
                    const stopTime = getStopTime(note, s);
                    if (stopTime <= playTime) continue;

                    const noteId = Math.floor(note.startTime * 1000) << 12 | note.pitch << 4 | ch; //`${ch}-${note.pitch}-${note.startTime}`;
                    const black = isBlackKey(note.pitch);
                    const noteWidth = black ? 0.58 : 0.86;
                    const noteHeight = black ? 0.38 : 0.32;
                    const x = -(note.pitch - 64);
                    const channelY = this._getChannelY(ch, black);

                    const startZ = note.startTime * zScale;
                    const endZ = stopTime * zScale;

                    const isPlaying = note.startTime < playTime;
                    const age = isPlaying ? playTime - note.startTime : 0;

                    // 裁切已播放部分：显示起始 Z = max(startZ, playZ)
                    const visibleStartZ = isPlaying ? Math.max(startZ, playZ) : startZ;
                    const visibleLength = endZ - visibleStartZ;

                    const material = this._getOrCreateNoteMaterial(noteId, ch, isPlaying, age);
                    const mesh = this._getMesh(material);
                    mesh.scale.set(noteWidth, noteHeight, Math.max(visibleLength, 0.3));
                    mesh.position.set(x, channelY, visibleStartZ);
                    mesh.visible = true;

                    if (isPlaying && s.highlightNotes) {
                        material.emissiveIntensity = Math.max(
                            s.noteBloomBase * Math.exp(-s.noteDecay * age),
                            s.noteBloomMin
                        );
                    } else {
                        material.emissiveIntensity = s.noteBloomIdle;
                    }

                    const meta = this._noteMaterialMap.get(noteId);
                    if (meta) meta.stopTime = stopTime;

                    // note-on 瞬间触发星星 & 播放线 boost 置 1
                    if (isPlaying) {
                        nowActive.add(noteId);
                        if (!this._activeNotes.has(noteId)) {
                            if (ch === 9) this._starBoost = 1;
                            this._playlineBoost = 1;
                            // 击键瞬间：环形冲击波
                            this._spawnNotePop(x, channelY + noteHeight, playZ, ch, note.velocity);
                        }
                        // 持续水花：每帧都生成
                        this._spawnNoteSplash(x, channelY + noteHeight, playZ, ch, note.velocity, age);
                    }
                }
            }
        }

        this._activeNotes = nowActive;

        // 隐藏未使用的 mesh
        for (let i = this._meshPoolIndex; i < this._meshPool.length; i++) {
            this._meshPool[i].visible = false;
        }

        // ── 应用独立 boost ──
        // 播放线
        this.playline.material.emissiveIntensity =
            s.playlineBaseEmissive + this._playlineBoost * s.playlineBoostMultiplier;

        // 星星 emissiveIntensity（独立三参数）
        const starEmissive = Math.max(
            s.starBloomBase * this._starBoost,   // boost 本身已指数衰减
            s.starBloomMin
        );
        this.starMaterial.emissiveIntensity = starEmissive;

        // 星星位置循环（仍用 InstancedMesh 更新矩阵）
        const dummy = new THREE.Object3D();
        const count = s.starCount;
        const viewBack = playZ - 250;      // 可视区后边界（较远）
        const viewFront = playZ + 350;     // 可视区前边界（较近）

        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            const x = this._starWorld[idx];
            const y = this._starWorld[idx + 1];
            let z = this._starWorld[idx + 2];

            // 将星星 Z 保持在可视区间内，每次恰好移动 600 单位
            while (z < viewBack) z += 600;
            while (z > viewFront) z -= 600;

            // 更新存储的绝对坐标（下次帧继续使用）
            this._starWorld[idx + 2] = z;

            dummy.position.set(x, y, z);
            dummy.updateMatrix();
            this.starInstancedMesh.setMatrixAt(i, dummy.matrix);
        }
        this.starInstancedMesh.instanceMatrix.needsUpdate = true;

        // 摄像机
        const camTargetX = 0;
        const camTargetY = this.cameraYOffset;
        const camTargetZ = playZ - this.cameraZOffset;
        this.camera.position.lerp(
            new THREE.Vector3(camTargetX, camTargetY, camTargetZ), 0.12
        );
        this.camera.lookAt(0, 1.2, playZ + this.cameraLookAhead);

        this.composer.render();

        if (s.prefmon) this._drawPerfMon();
    }

    // ── 音符独立材质管理（不变） ──
    _getOrCreateNoteMaterial(noteId, channel, isPlaying, age) {
        const existing = this._noteMaterialMap.get(noteId);
        if (existing) return existing.material;

        let material = this._materialPool.pop();
        if (material) {
            material.color.set(this.palette[channel]);
            material.emissive.set(this.palette[channel]);
            material.emissiveIntensity = isPlaying ? this.settings.noteBloomBase : this.settings.noteBloomIdle;
            material.opacity = 0.92;
            material.transparent = true;
        } else {
            material = new THREE.MeshStandardMaterial({
                color: this.palette[channel],
                emissive: new THREE.Color(this.palette[channel]),
                emissiveIntensity: isPlaying ? this.settings.noteBloomBase : this.settings.noteBloomIdle,
                metalness: 0.18,
                roughness: 0.36,
                transparent: true,
                opacity: 0.92
            });
        }
        this._noteMaterialMap.set(noteId, { material, stopTime: Infinity, mesh: null });
        return material;
    }

    _cleanExpiredNotes(currentTime) {
        for (const [noteId, meta] of this._noteMaterialMap.entries()) {
            if (meta.stopTime <= currentTime) {
                meta.material.emissiveIntensity = 0;
                this._materialPool.push(meta.material);
                this._noteMaterialMap.delete(noteId);
            }
        }
    }

    // ── 辅助方法（不变） ──
    _fitCameraToDisplayWidth() {
        const aspect = Math.max(this.camera.aspect, 0.1);
        // 轨道中心点：y 取通道高度中间值（如1.5），z 为当前播放线位置（cameraZOffset 即相机与该点的前后距离）
        const trackCenterY = 1.5;
        const distanceToTrack = Math.hypot(this.cameraYOffset - trackCenterY, this.cameraZOffset);
        // 计算让轨道宽度恰好填满水平方向所需的垂直视场角
        const requiredFov = THREE.MathUtils.radToDeg(
            2 * Math.atan(this.trackWidth / (2 * distanceToTrack * aspect))
        );
        // 放宽上下限，竖屏时 FOV 可超过 82°
        this.camera.fov = THREE.MathUtils.clamp(requiredFov, 40, 120);
    }

    _getChannelY(channel, isBlackKeyNote) {
        return this.channelLaneBase + channel * this.channelLaneStep + (isBlackKeyNote ? 0.08 : 0);
    }

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

    _createPopTexture(type) {
        const size = 96;
        const popCanvas = document.createElement('canvas');
        popCanvas.width = size;
        popCanvas.height = size;
        const popCtx = popCanvas.getContext('2d');
        const center = size / 2;

        if (type === 'ring') {
            const ring = popCtx.createRadialGradient(center, center, 18, center, center, 44);
            ring.addColorStop(0, 'rgba(255,255,255,0)');
            ring.addColorStop(0.48, 'rgba(255,255,255,0)');
            ring.addColorStop(0.62, 'rgba(255,255,255,1)');
            ring.addColorStop(0.78, 'rgba(255,255,255,0.35)');
            ring.addColorStop(1, 'rgba(255,255,255,0)');
            popCtx.fillStyle = ring;
        } else {
            const dot = popCtx.createRadialGradient(center, center, 0, center, center, 44);
            dot.addColorStop(0, 'rgba(255,255,255,1)');
            dot.addColorStop(0.18, 'rgba(255,255,255,0.95)');
            dot.addColorStop(0.55, 'rgba(255,255,255,0.28)');
            dot.addColorStop(1, 'rgba(255,255,255,0)');
            popCtx.fillStyle = dot;
        }
        popCtx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(popCanvas);
    }

    _getPopSprite(texture) {
        const pooled = this._popPool.pop();
        if (pooled) {
            pooled.sprite.material.map = texture;
            return pooled;
        }
        const material = new THREE.SpriteMaterial({
            map: texture,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false
        });
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        this.scene.add(sprite);
        return { sprite, velocity: new THREE.Vector3() };
    }

    _spawnPopSprite(texture, color, x, y, z, options) {
        const effect = this._getPopSprite(texture);
        effect.sprite.visible = true;
        effect.sprite.position.set(x, y, z);
        effect.sprite.material.color.copy(color);
        effect.sprite.material.opacity = options.opacity;
        effect.sprite.material.rotation = Math.random() * Math.PI * 2;
        effect.sprite.scale.setScalar(options.startScale);
        effect.velocity.copy(options.velocity);
        effect.age = 0;
        effect.lifetime = options.lifetime;
        effect.startScale = options.startScale;
        effect.endScale = options.endScale;
        effect.opacity = options.opacity;
        effect.spin = options.spin || 0;
        this._popEffects.push(effect);
    }

    _spawnNotePop(x, y, z, channel, velocity) {
        const color = new THREE.Color(this.palette[channel]);
        const v = velocity;
        // 仅环形冲击波
        this._spawnPopSprite(this.popRingTexture, color, x, y + 0.1, z, {
            velocity: new THREE.Vector3(0, 0.25 * (0.4 + v * 0.6), 0),
            lifetime: 0.58,
            startScale: 0.6 + v * 3,
            endScale: 2.5 + v * 8,
            opacity: 1,
            spin: (Math.random() - 0.5) * 2
        });
    }

    _spawnNoteSplash(x, y, z, channel, velocity, age) {
        const color = new THREE.Color(this.palette[channel]);
        const v = velocity;
        const intensity = Math.exp(-this.settings.noteDecay * age) * 4;

        // 使用 Box‑Muller 生成两个独立的标准正态分布随机数
        let u1, u2;
        do { u1 = Math.random(); } while (u1 === 0);
        u2 = Math.random();
        const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);

        const sigma = (0.5 + v * 1.5) * intensity;
        const vx = z0 * sigma;   // 水平 X
        const vy = z1 * sigma;   // 水平 Z
        const vz = 0;


        this._spawnPopSprite(this.popDotTexture, color, x, y, z, {
            velocity: new THREE.Vector3(vx, vy, vz),   // 正确顺序：X(横向), Y(高度), Z(前后)
            lifetime: 0.25 * intensity + Math.random() * 0.2,
            startScale: (0.7 + Math.random() * 0.4) * (0.4 + v * 0.4) * intensity,
            endScale: 0.05,
            opacity: 0.8
        });
    }

    _updatePopEffects(deltaTime) {
        for (let i = this._popEffects.length - 1; i >= 0; i--) {
            const effect = this._popEffects[i];
            effect.age += deltaTime;
            if (effect.age >= effect.lifetime) {
                effect.sprite.visible = false;
                effect.sprite.material.opacity = 0;
                this._popEffects.splice(i, 1);
                this._popPool.push(effect);
                continue;
            }
            const progress = effect.age / effect.lifetime;
            const expProgress = 1 - Math.exp(-progress * 5);
            const fade = Math.exp(-progress * 5.6);
            const scale = THREE.MathUtils.lerp(effect.startScale, effect.endScale, expProgress);
            effect.velocity.y -= 9.5 * deltaTime;
            effect.sprite.position.addScaledVector(effect.velocity, deltaTime);
            effect.sprite.scale.setScalar(scale);
            effect.sprite.material.opacity = effect.opacity * fade;
            effect.sprite.material.rotation += effect.spin * deltaTime;
        }
    }

    _drawPerfMon() {
        const now = performance.now();
        const frameTime = now - this.lastDrawTime;
        this.lastDrawTime = now;
        this.timeList.push(frameTime);
        if (this.timeList.length > 120) this.timeList.shift();
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
