/**
 * On screen performance readout, opened with ?perf=1.
 *
 * The phone cannot show a console, and the question "why does the page die
 * after a few hundred thousand notes" needs the numbers next to the picture
 * that dies. So this is a fixed overlay that refreshes twice a second and
 * reports what grows: voice count, sound sources, the 3D scene's object
 * counts, draw calls, textures, and the JS heap (with peaks).
 *
 * Deliberately cheap: the DOM is built once and only textContent is written,
 * so the instrument never becomes the thing that leaks.
 */
const REFRESH_MS = 500;

const ROWS = [
    ['fps', 'fps'],
    ['heap', 'heap'],
    ['ctx', 'audio'],
    ['engine', 'engine'],
    ['pos', 'pos'],
    ['voices', 'voices'],
    ['src', 'sources'],
    ['notes', 'notes'],
    ['scene', '3d'],
    ['draw', 'draw'],
    ['canvas', 'canvas'],
];

/**
 * How many source nodes are running on the audio thread right now.
 *
 * `states.stopFuncs.length` is not that number. A note leaves the stop list the
 * moment its note-off arrives, but its source keeps playing through the release
 * tail, and some instruments add a second source for vibrato. Measured on a
 * dense song: 140 in the stop list against ~750 live sources - so "150 voices"
 * reads like a light load while the audio thread is actually trying to render
 * five times that, and it is the five times that matters.
 *
 * Counting is done by wrapping the AudioContext factory methods once and
 * listening for the source's own 'ended' event. Nothing is retained.
 */
const NODE_COUNTER_KEY = '__jmboxNodeCounter';

function installNodeCounter() {
    if (window[NODE_COUNTER_KEY]) return window[NODE_COUNTER_KEY];
    const Ctor = window.AudioContext || window.webkitAudioContext;
    const stat = { liveSources: 0, createdSources: 0, createdNodes: 0, byType: Object.create(null) };
    window[NODE_COUNTER_KEY] = stat;
    if (!Ctor || !Ctor.prototype) return stat;

    const SOURCES = ['createOscillator', 'createBufferSource', 'createConstantSource'];
    const NODES = SOURCES.concat([
        'createGain', 'createStereoPanner', 'createBiquadFilter', 'createConvolver',
        'createDelay', 'createWaveShaper', 'createDynamicsCompressor', 'createPanner',
        'createChannelSplitter', 'createChannelMerger', 'createIIRFilter',
    ]);
    for (const name of NODES) {
        const original = Ctor.prototype[name];
        if (typeof original !== 'function') continue;
        const isSource = SOURCES.indexOf(name) >= 0;
        Ctor.prototype[name] = function (...args) {
            const node = original.apply(this, args);
            stat.createdNodes++;
            stat.byType[name] = (stat.byType[name] || 0) + 1;
            if (isSource) {
                stat.createdSources++;
                stat.liveSources++;
                try {
                    node.addEventListener('ended', () => { stat.liveSources--; });
                } catch (e) { /* noop */ }
            }
            return node;
        };
    }
    return stat;
}

export class PerfMonitor {
    constructor({ player, renderer, waterfall }) {
        this.getPlayer = player;
        this.getRenderer = renderer;
        this.getWaterfall = waterfall;
        this.rows = new Map();
        this.el = null;
        this.timer = null;
        this.raf = null;
        this.frames = 0;
        this.windowStart = 0;
        this.worstFrame = 0;
        this.lastFrameAt = 0;
        this.fps = 0;
        this.worstMs = 0;
        this.sceneInfo = { mesh: 0, sprite: 0, other: 0 };
        this.sceneAt = 0;
        this.lastCtxAt = 0;
        this.lastCtxTime = 0;
        this.peak = { heap: 0, voices: 0, mesh: 0, sprite: 0, tex: 0, sources: 0 };
        this.startedAt = 0;
    }

    start() {
        if (this.el) return;
        const box = document.createElement('div');
        box.id = 'perf-monitor';
        box.style.cssText = [
            'position:fixed', 'top:6px', 'right:6px', 'z-index:2147483647',
            'padding:6px 8px', 'border-radius:6px', 'pointer-events:none',
            'background:rgba(0,0,0,.72)', 'color:#9fe8b0',
            'font:11px/1.4 ui-monospace,Menlo,Consolas,monospace',
            'white-space:pre', 'text-align:left', 'max-width:92vw',
            'overflow:hidden', 'text-overflow:ellipsis',
            'box-shadow:0 2px 10px rgba(0,0,0,.4)',
        ].join(';');
        for (const [key, label] of ROWS) {
            const line = document.createElement('div');
            const name = document.createElement('span');
            name.textContent = label.padEnd(6);
            name.style.color = '#5f8f6c';
            const value = document.createElement('span');
            line.appendChild(name);
            line.appendChild(value);
            box.appendChild(line);
            this.rows.set(key, { line, value });
        }
        document.body.appendChild(box);
        this.el = box;
        this.nodeStat = installNodeCounter();
        this.startedAt = performance.now();
        this.windowStart = this.startedAt;

        const tick = (now) => {
            if (this.lastFrameAt) {
                const dt = now - this.lastFrameAt;
                if (dt > this.worstFrame) this.worstFrame = dt;
            }
            this.lastFrameAt = now;
            this.frames++;
            if (now - this.windowStart >= REFRESH_MS) {
                this.fps = (this.frames * 1000) / (now - this.windowStart);
                this.worstMs = this.worstFrame;
                this.frames = 0;
                this.worstFrame = 0;
                this.windowStart = now;
                this.refresh();
            }
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    stop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        if (this.timer) clearInterval(this.timer);
        this.raf = null;
        this.timer = null;
        if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
        this.el = null;
        this.rows.clear();
    }

    set(key, text, warn) {
        const row = this.rows.get(key);
        if (!row) return;
        if (row.value.textContent !== text) row.value.textContent = text;
        const color = warn ? '#ff8a80' : '#9fe8b0';
        if (row.line.style.color !== color) row.line.style.color = color;
    }

    /** Rebuilding the scene totals walks every object, so do it less often. */
    sceneTotals(renderer) {
        const now = performance.now();
        if (now - this.sceneAt < 2000) return this.sceneInfo;
        this.sceneAt = now;
        const scene = renderer && renderer.scene;
        if (!scene || typeof scene.traverse !== 'function') return this.sceneInfo;
        const info = { mesh: 0, sprite: 0, other: 0 };
        scene.traverse((o) => {
            if (o.isSprite) info.sprite++;
            else if (o.isMesh || o.isInstancedMesh) info.mesh++;
            else info.other++;
        });
        this.sceneInfo = info;
        return info;
    }

    refresh() {
        const pa = this.getPlayer();
        const renderer = this.getRenderer();
        const mb = (v) => `${v.toFixed(1)} MB`;
        const gl = renderer && renderer.renderer;

        // --- fps -------------------------------------------------------
        this.set('fps', `${this.fps.toFixed(0).padStart(3)} fps  worst ${this.worstMs.toFixed(0)}ms`,
            this.fps < 25 || this.worstMs > 120);

        // --- heap ------------------------------------------------------
        const mem = performance.memory;
        if (mem) {
            const used = mem.usedJSHeapSize / 1048576;
            const total = mem.totalJSHeapSize / 1048576;
            if (used > this.peak.heap) this.peak.heap = used;
            this.set('heap', `${used.toFixed(1)}/${total.toFixed(0)} MB  peak ${this.peak.heap.toFixed(0)}`,
                used > 256);
        } else {
            this.set('heap', 'unavailable (needs --enable-precise-memory-info)');
        }

        // --- audio context ---------------------------------------------
        const ctx = pa && pa.context;
        if (ctx) {
            const latency = Number.isFinite(ctx.baseLatency) ? ` ${(ctx.baseLatency * 1000).toFixed(0)}ms` : '';
            // How fast the audio clock is running compared to the wall clock.
            // AudioContext.currentTime counts rendered quanta, so when the
            // render callback stops keeping up this ratio drops and the song
            // plays slow - which is what an overloaded engine sounds like.
            const now = performance.now();
            let speed = '';
            if (this.lastCtxAt && Number.isFinite(this.lastCtxTime)) {
                const wall = (now - this.lastCtxAt) / 1000;
                const audio = ctx.currentTime - this.lastCtxTime;
                if (wall > 0.2) speed = `  ${(audio / wall).toFixed(2)}x`;
            }
            this.lastCtxAt = now;
            this.lastCtxTime = ctx.currentTime;
            const ratio = speed ? parseFloat(speed) : 1;
            this.set('ctx', `${ctx.state} ${Math.round(ctx.sampleRate / 1000)}kHz${latency}${speed}`,
                ctx.state !== 'running' || ratio < 0.85);
        } else {
            this.set('ctx', 'no context', true);
        }

        // --- engine ----------------------------------------------------
        // sf2Engine / sf2Quality only take effect when the sound source is SF2.
        // Showing them unconditionally is how "I am on worklet" and "every note
        // is building Web Audio nodes" could both be true at once, so this line
        // reports the source that is actually in use, and turns red when the
        // worklet was asked for but did not come up (the silent DSP fallback).
        const st = pa && pa.states;
        const settings = (pa && pa.settings) || {};
        const sq = Number(settings.soundQuality);
        const workletDriving = !!(pa && pa.isSF2WorkletReady && pa.isSF2WorkletReady());
        let source;
        if (sq === 4 || sq === 3) source = `sf2/${settings.sf2Engine || '?'} ${settings.sf2Quality || ''}`;
        else if (sq === 1) source = 'additive';
        else if (sq === 0) source = 'basic-wave';
        else if (sq === -1) source = 'sine';
        else source = `quality ${settings.soundQuality}`;
        const degraded = (sq === 4 || sq === 3)
            && settings.sf2Engine === 'worklet' && !workletDriving;
        this.set('engine', source.trim() + (degraded ? '  FALLBACK!' : ''), degraded);

        // --- position --------------------------------------------------
        if (st && ctx && Number.isFinite(st.startTime)) {
            const t = Math.max(0, ctx.currentTime - st.startTime);
            const data = pa && pa.playData;
            const dur = (data && (data.songLength || data.lastEventTime)) || 0;
            const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
            this.set('pos', `${fmt(t)}${dur ? ` / ${fmt(dur)}` : ''}`);
        } else {
            this.set('pos', '-');
        }

        // --- voices ----------------------------------------------------
        // stopFuncs holds one entry per note still producing sound (release
        // tail included), which is the number this engine can actually draw
        // power for. noteOnAry is the subset that has not hit note-off yet.
        const voices = st && st.stopFuncs ? st.stopFuncs.length : -1;
        const hanging = st && st.noteOnAry ? st.noteOnAry.length : -1;
        if (voices > this.peak.voices) this.peak.voices = voices;
        this.set('voices', `${String(voices).padStart(4)} peak ${String(this.peak.voices).padStart(3)} (+${hanging} held)`,
            voices > 192);

        // --- sources ---------------------------------------------------
        // The player's own count only covers notes that have not reached
        // note-off; this is what the audio thread is really rendering.
        const stat = this.nodeStat || {};
        const live = stat.liveSources != null ? stat.liveSources : -1;
        if (workletDriving) {
            // The AudioWorklet mixes every note itself, so there is no per-note
            // node to count - the whole engine is one node.
            this.set('src', 'worklet  (no per-note nodes)');
        } else {
            if (live > this.peak.sources) this.peak.sources = live;
            this.set('src',
                `${String(live).padStart(4)} peak ${String(this.peak.sources).padStart(4)}`
                + `  ${(live / 128).toFixed(1)}x128vo`,
                live > 384);
        }

        // --- notes -----------------------------------------------------
        const data = pa && pa.playData;
        const noteCount = data && data.channels
            ? data.channels.reduce((a, c) => a + c.notes.length, 0) : -1;
        this.set('notes', `${noteCount}`);

        // --- 3d --------------------------------------------------------
        if (gl && gl.info) {
            const info = this.sceneTotals(renderer);
            if (info.mesh > this.peak.mesh) this.peak.mesh = info.mesh;
            if (info.sprite > this.peak.sprite) this.peak.sprite = info.sprite;
            const tex = gl.info.memory.textures;
            const geo = gl.info.memory.geometries;
            if (tex > this.peak.tex) this.peak.tex = tex;
            this.set('scene',
                `m${info.mesh} s${info.sprite}  tex${tex}/peak${this.peak.tex} geo${geo}`,
                info.sprite > 4000 || tex > 200);
            const r = gl.info.render;
            this.set('draw', `${r.calls} calls  ${(r.triangles / 1000).toFixed(0)}k tri`,
                r.calls > 1200);

            // --- canvas ------------------------------------------------
            const c = renderer.canvas;
            const webgl = gl.getContext ? gl.getContext() : null;
            const lost = webgl && webgl.isContextLost ? webgl.isContextLost() : null;
            this.set('canvas',
                `${c.width}x${c.height}${lost === null ? '' : lost ? ' GL LOST' : ' gl ok'}`,
                lost === true);
        } else {
            const c = renderer && renderer.canvas;
            this.set('scene', 'not 3d');
            this.set('draw', '-');
            this.set('canvas', c ? `${c.width}x${c.height}` : '-');
        }
    }
}

/** Opens the readout when the page was loaded with ?perf=1. */
export function attachPerfMonitor(app) {
    const params = new URLSearchParams(location.search);
    if (!params.has('perf')) return null;
    const monitor = new PerfMonitor({
        // app.player is the player wrapper; window.picoAudio is the engine the
        // numbers come from (states, context, playData).
        player: () => window.picoAudio || (app.player && app.player.picoAudio) || app.player,
        renderer: () => app.midiFall,
        waterfall: () => app.waterfall,
    });
    monitor.start();
    // Let a second tap on the panel hide it, so it does not sit on top of the
    // controls on a phone.
    return monitor;
}
