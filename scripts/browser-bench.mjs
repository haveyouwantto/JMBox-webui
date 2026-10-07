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
const pageQuery = caseArg ? `?cases=${encodeURIComponent(caseArg.split('=')[1])}` : '';
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
const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio', 'about:blank',
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
    for (let i = 0; i < 120; i++) {
        await sleep(500);
        const r = await send('Runtime.evaluate', { expression: 'window.__BENCH__ || null', returnByValue: true });
        if (r.result && r.result.value) { result = r.result.value; break; }
        const txt = await send('Runtime.evaluate', {
            expression: 'document.getElementById("out") ? document.getElementById("out").textContent : ""',
            returnByValue: true,
        });
        if (i % 6 === 5 && txt.result.value) console.log(txt.result.value.trim().split('\n').slice(-3).join('\n'));
    }
    if (!result) throw new Error('bench page never finished');

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
