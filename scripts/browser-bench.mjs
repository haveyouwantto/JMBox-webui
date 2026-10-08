/**
 * Drive headless Chrome against test_samples/browser/bench.html so the SF2
 * engines can be checked in the browser they actually run in.
 *
 * The Node harness (scripts/sf2-engine-ab.mjs, sf2-program-sweep.mjs) uses
 * node-web-audio-api, which is a re-implementation: it cannot tell us what
 * Chrome does with automation scheduled in the past, and its rendering speed
 * says nothing about the real audio thread.
 *
 * Usage: node scripts/browser-bench.mjs <font.sf2> [--keep]
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const fontPath = path.resolve(positional[0] || 'resources/assets/Neo1MGM.sf2');
const songPath = positional[1] ? path.resolve(positional[1]) : null;
const font2Arg = args.find((a) => a.startsWith('--font2='));
const font2Path = font2Arg ? path.resolve(font2Arg.split('=')[1]) : null;
const keep = args.includes('--keep');
const page = (args.find((a) => a.startsWith('--page=')) || '--page=bench').split('=')[1];
const caseArg = args.find((a) => a.startsWith('--cases='));
const queryArg = args.find((a) => a.startsWith('--query='));
const pageQuery = queryArg ? `?${queryArg.slice('--query='.length)}`
    : (caseArg ? `?cases=${encodeURIComponent(caseArg.split('=')[1])}` : '');
const ROOT = path.resolve('.');

const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('no Chrome/Edge found'); process.exit(1); }

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.json': 'application/json', '.wasm': 'application/wasm', '.sf2': 'application/octet-stream',
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__font.sf2') {
        const buf = fs.readFileSync(fontPath);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
        res.end(buf);
        return;
    }
    if (url.pathname === '/__song.mid' && songPath) {
        const buf = fs.readFileSync(songPath);
        res.writeHead(200, { 'content-type': 'audio/midi', 'content-length': buf.length });
        res.end(buf);
        return;
    }
    if (url.pathname === '/__font2.sf2' && font2Path) {
        const buf = fs.readFileSync(font2Path);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length });
        res.end(buf);
        return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let file = path.join(ROOT, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    // the submodule's sources omit the .js extension (webpack resolves it)
    if (!fs.existsSync(file) && !path.extname(file)) {
        if (fs.existsSync(file + '.js')) file += '.js';
        else if (fs.existsSync(path.join(file, 'index.js'))) file = path.join(file, 'index.js');
    }
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'text/plain' });
    res.end(fs.readFileSync(file));
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

const debugPort = 9222 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sf2-bench-'));
// BENCH_HEADED runs an off-screen but otherwise normal Chrome: a real audio
// device has real callback deadlines, which the headless null sink does not.
const windowArgs = process.env.BENCH_HEADED
    ? ['--window-position=-2600,-2600', '--window-size=200,200']
    : ['--headless=new'];
const chrome = spawn(CHROME, [
    ...windowArgs, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank',
    ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []),
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = '';
chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForJson(url, tries = 60) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.ok) return await res.json();
        } catch (e) { /* not up yet */ }
        if (chrome.exitCode !== null) break;
        await sleep(250);
    }
    throw new Error(`timed out waiting for ${url}${chromeErr ? `\nchrome said:\n${chromeErr}` : ''}`);
}

const cleanup = () => {
    try { chrome.kill(); } catch (e) { /* noop */ }
    server.close();
    if (!keep) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* noop */ } }
};

try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const target = await waitForJson(`http://127.0.0.1:${debugPort}/json/new?`
        + encodeURIComponent(`http://127.0.0.1:${port}/test_samples/browser/${page}.html${pageQuery}`), 5)
        .catch(async () => {
            const res = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
            return res.json();
        });
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const send = (method, params) => new Promise((resolve, reject) => {
        const msgId = ++id;
        pending.set(msgId, { resolve, reject });
        ws.send(JSON.stringify({ id: msgId, method, params }));
    });
    const events = [];
    await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
    });
    ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(JSON.stringify(msg.error)));
            else resolve(msg.result);
        } else if (msg.method) {
            events.push(msg);
            if (msg.method === 'Runtime.exceptionThrown') {
                const d = msg.params.exceptionDetails;
                console.log(`  [page error] ${d.exception ? d.exception.description : d.text}`);
            }
            if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
                console.log(`  [page console.error] `
                    + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
            }
            if (msg.method === 'Runtime.consoleAPICalled') {
                const line = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
                if (line) console.log(`  [page] ${line}`);
            }
            if (msg.method === 'Log.entryAdded') {
                console.log(`  [page log] ${msg.params.entry.level}: ${msg.params.entry.text} `
                    + `${msg.params.entry.url || ''}`);
            }
        }
    };
    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/test_samples/browser/${page}.html${pageQuery}` });

    let result;
    const timeoutMs = Number(process.env.BENCH_TIMEOUT || 120) * 1000;
    // BENCH_CPU: sample per-process CPU of the whole Chrome tree so the audio
    // thread's cost is visible (it is not on the page's main thread). Windows
    // are delimited by window.__RT_STATE__ {engine, phase} from the page.
    const cpuProbe = !!process.env.BENCH_CPU;
    const cpuSamples = [];
    const markers = {};
    // SystemInfo lives on the browser target, not the page target
    let cpuSend = null;
    if (cpuProbe) {
        try {
            const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json();
            const browserWs = new WebSocket(version.webSocketDebuggerUrl);
            await new Promise((res, rej) => { browserWs.onopen = res; browserWs.onerror = rej; });
            let bid = 0;
            const bpending = new Map();
            browserWs.onmessage = (m) => {
                const msg = JSON.parse(m.data);
                if (msg.id && bpending.has(msg.id)) {
                    const { resolve, reject } = bpending.get(msg.id);
                    bpending.delete(msg.id);
                    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                    else resolve(msg.result);
                }
            };
            cpuSend = (method, params) => new Promise((resolve, reject) => {
                const msgId = ++bid;
                bpending.set(msgId, { resolve, reject });
                browserWs.send(JSON.stringify({ id: msgId, method, params }));
            });
        } catch (e) {
            console.log(`  [cpu] browser target unavailable: ${e.message}`);
        }
    }
    for (let i = 0; i < timeoutMs / 500; i++) {
        await sleep(500);
        if (cpuSend) {
            const info = await cpuSend('SystemInfo.getProcessInfo').catch((e) => {
                if (i === 0) console.log(`  [cpu] ${e.message}`);
                return null;
            });
            if (info) {
                const byType = {};
                let total = 0;
                for (const p of info.processInfo || []) {
                    const cpu = p.cpuTime || 0;
                    total += cpu;
                    byType[p.type] = (byType[p.type] || 0) + cpu;
                }
                cpuSamples.push({ t: Date.now(), total, byType });
            }
        }
        const r = await send('Runtime.evaluate', { expression: 'window.__BENCH__ || null', returnByValue: true });
        if (r.result && r.result.value) { result = r.result.value; break; }
        const txt = await send('Runtime.evaluate', {
            expression: 'document.getElementById("out") ? document.getElementById("out").textContent : ""',
            returnByValue: true,
        });
        if (i % 6 === 5 && txt.result.value) console.log(txt.result.value.trim().split('\n').slice(-3).join('\n'));
    }
    if (!result) throw new Error('bench page never finished');

    if (cpuProbe) {
        // Page side transition log -> driver clock, then interpolate the CPU
        // samples between the two timestamps of each playback window.
        const logRead = await send('Runtime.evaluate', {
            expression: 'JSON.stringify({ log: window.__RT_LOG__ || [], epoch: window.__RT_EPOCH__ || 0 })',
            returnByValue: true,
        }).catch(() => null);
        const pageLog = logRead && logRead.result && logRead.result.value
            ? JSON.parse(logRead.result.value) : { log: [], epoch: 0 };
        const cpuAt = (driverTime) => {
            if (!cpuSamples.length) return null;
            let before = cpuSamples[0], after = cpuSamples[cpuSamples.length - 1];
            for (const s of cpuSamples) {
                if (s.t <= driverTime) before = s;
                if (s.t >= driverTime) { after = s; break; }
            }
            if (after === before) return before;
            const k = (driverTime - before.t) / (after.t - before.t);
            const byType = {};
            for (const key of new Set([...Object.keys(before.byType), ...Object.keys(after.byType)])) {
                byType[key] = (before.byType[key] || 0) + ((after.byType[key] || 0) - (before.byType[key] || 0)) * k;
            }
            return { t: driverTime, total: before.total + (after.total - before.total) * k, byType };
        };
        for (const entry of pageLog.log) {
            markers[entry.engine] = markers[entry.engine] || {};
            markers[entry.engine][entry.phase] = { t: pageLog.epoch + entry.wall, cpu: cpuAt(pageLog.epoch + entry.wall) };
        }
        const cpuReport = {};
        for (const [engine, phases] of Object.entries(markers)) {
            const start = phases.playing, end = phases.done;
            if (!start || !end || !start.cpu || !end.cpu) continue;
            const seconds = (end.t - start.t) / 1000;
            cpuReport[engine] = {
                windowSeconds: +seconds.toFixed(2),
                cpuSeconds: +(end.cpu.total - start.cpu.total).toFixed(2),
                byType: Object.fromEntries(Object.entries(end.cpu.byType)
                    .map(([k, v]) => [k, +((end.cpu.byType[k] || 0) - (start.cpu.byType[k] || 0)).toFixed(2)])
                    .filter(([, v]) => v > 0.005)),
            };
            cpuReport[engine].coresUsed = +(cpuReport[engine].cpuSeconds / seconds).toFixed(3);
        }
        result.cpu = cpuReport;
        console.log('\nCPU during real playback (whole Chrome process tree, audio thread included):');
        if (process.env.BENCH_CPU_DEBUG) console.log(`  markers: ${JSON.stringify(markers)}\n  cpu samples: ${cpuSamples.length}`);
        for (const [engine, r] of Object.entries(cpuReport)) {
            console.log(`  ${engine.padEnd(10)} ${r.windowSeconds}s window: ${r.cpuSeconds}s CPU = `
                + `${r.coresUsed} cores  ${JSON.stringify(r.byType)}`);
        }
    }

    console.log(`\nfont: ${fontPath}${songPath ? `\nsong: ${songPath}` : ''}`);
    console.log(`ua: ${result.ua}`);
    if (result.info) console.log(`info: ${JSON.stringify(result.info)}`);
    if (result.fontSwap) console.log(`font swap: ${result.fontSwap.levelDiff.toFixed(2)} dB `
        + `(a note rendered after loading a second font into the same context, vs a fresh context)`);
    if (result.info) {
        for (const w of result.windows || []) {
            console.log(`${w.t.toFixed(1).padStart(6)}s | ${(20 * Math.log10(w.rd)).toFixed(1).padStart(6)} / `
                + `${(20 * Math.log10(w.rg)).toFixed(1).padStart(6)} dB | centroid ${w.cda.toFixed(0)}/${w.cgb.toFixed(0)} Hz | `
                + w.diff.map((d) => d.toFixed(1).padStart(5)).join(' '));
        }
        if (result.perf) console.log(`perf: dsp ${result.perf.dspMs.toFixed(0)}ms, graph ${result.perf.graphMs.toFixed(0)}ms `
            + `for ${result.perf.seconds}s of audio`);
        if (result.badTimes) console.log(`AudioParam calls ${result.badTimes.total}, `
            + `negative ${result.badTimes.negative} [${result.badTimes.negativeSamples.join('; ')}], `
            + `past ${result.badTimes.past} [${result.badTimes.pastSamples.join('; ')}]`);
    } else {
        console.log('\ncase                | level dB | med dB | corr   | centroid dsp/graph | peak dsp/graph');
        for (const c of result.cases) {
            console.log(`${c.label.padEnd(19)} | ${c.levelDiff.toFixed(2).padStart(8)} | `
                + `${c.med.toFixed(2).padStart(6)} | ${c.corr.toFixed(4)} | `
                + `${c.centroidDsp.toFixed(4)}/${c.centroidGraph.toFixed(4)} | `
                + `${c.peakDsp.toFixed(3)}/${c.peakGraph.toFixed(3)}${c.stop ? '' : ' NO-STOP'}`);
        }
        console.log(`\nscheduling: dsp ${result.perf.scheduleDspMs.toFixed(1)}ms, `
            + `graph ${result.perf.scheduleGraphMs.toFixed(1)}ms, `
            + `graph offline render ${result.perf.renderGraphMs.toFixed(0)}ms`);
        console.log(`\nrealtime probe (currentTime ${result.probe.currentTime.toFixed(3)}, `
            + `baseLatency ${result.probe.baseLatency.toFixed(4)}, state ${result.probe.state}):`);
        for (const l of result.probe.log) console.log(`  ${l}`);
        console.log(`  past curve value before ${result.probe.valueBefore.toFixed(4)} `
            + `after ${result.probe.valueAfter.toFixed(4)}`);
    }

    if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(result, null, 2));
} finally {
    cleanup();
}
