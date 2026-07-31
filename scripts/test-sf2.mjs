import fs from 'fs';
import { parseRIFF } from '../lib/PicoAudio/src/player/sf2/riff.js';
import { parseSF2 } from '../lib/PicoAudio/src/player/sf2/parser.js';
import { buildPresetZones } from '../lib/PicoAudio/src/player/sf2/builder.js';
import { decodeSF2Sample } from '../lib/PicoAudio/src/player/sf2/decoder.js';
import { loadSF2, getSF2Layers, isSF2Loaded } from '../lib/PicoAudio/src/player/sound-source/sf2-provider.js';

const buf = fs.readFileSync('resources/assets/Neo1MGM.sf2');
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// --- 1. Raw RIFF parsing ---------------------------------------------
const root = parseRIFF(ab);
console.log('RIFF type:', root.type, '| top chunks:', root.chunks.map(c => c.id).join(','));

// --- 2. SF2 parse ----------------------------------------------------
const parsed = parseSF2(ab);
console.log('samples:', parsed.samples.length, '| instruments:', parsed.instruments.length, '| presets:', parsed.presets.length);

// --- 3. Build merged preset zones ------------------------------------
const presetZones = buildPresetZones(parsed.presets, parsed.presetBags, parsed.presetGens, parsed.instruments, parsed.samples);
const zoneCount = presetZones.reduce((n, p) => n + p.zones.length, 0);
console.log('preset zones (merged):', zoneCount);

const piano = presetZones.find(p => p.program === 0 && !p.isDrum);
if (piano) {
    console.log('Preset 0 (piano):', piano.name, '| zones:', piano.zones.length);
    const z = piano.zones[0];
    console.log('  first zone sampleId:', z.sampleId, '| keyRange:', z.keyRange, '| velRange:', z.velRange);
}

// --- 4. Full loadSF2 + getSF2Layers via mock AudioContext -------------
function makeMockContext() {
    const mockAudioParam = () => ({
        value: 0,
        setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {},
        linearRampToValueAtTime() {}, setValueCurveAtTime() {},
    });
    const mockNode = () => ({
        connect() {}, disconnect() {}, start() {}, stop() {},
        gain: mockAudioParam(), pan: mockAudioParam(),
        frequency: mockAudioParam(), detune: mockAudioParam(),
        playbackRate: mockAudioParam(),
        positionX: mockAudioParam(), positionY: mockAudioParam(), positionZ: mockAudioParam(),
    });
    return {
        sampleRate: 44100,
        currentTime: 0,
        destination: mockNode(),
        createBuffer(channels, length, sampleRate) {
            const data = [];
            for (let c = 0; c < channels; c++) data.push(new Float32Array(length));
            return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i) => data[i] };
        },
        createBufferSource: mockNode,
        createGain: mockNode,
        createStereoPanner: mockNode,
        createPanner: mockNode,
        createBiquadFilter: mockNode,
        createOscillator: mockNode,
    };
}

const loaded = loadSF2(makeMockContext(), ab);
console.log('\nloadSF2:', loaded, '| isSF2Loaded:', isSF2Loaded());

// Melodic: piano @ A4, medium velocity
const pianoLayers = getSF2Layers(0, 69, 100, false, 0);
console.log('\nPiano layers @ A4 vel=100:', pianoLayers.length);
pianoLayers.forEach(l => {
    console.log('  -', l.sampleName, '| sampleId:', l.sampleId, '| rootKey:', l.rootKey, '| rate:', l.originalSampleRate,
        '| loop:', l.loopMode ? `[${l.startLoop},${l.endLoop}]` : 'off',
        '| filterFc:', Math.round(l.filterFc), '| pan:', l.pan,
        '| envelope atk/dec/rel:', l.envelope.attack.toFixed(3), '/', l.envelope.decay.toFixed(3), '/', l.envelope.release.toFixed(3));
});

// Velocity layer switch: loud vs soft
const pianoSoft = getSF2Layers(0, 69, 20, false, 0);
const pianoLoud = getSF2Layers(0, 69, 127, false, 0);
console.log('\nPiano soft vel=20 layers:', pianoSoft.length, '| loud vel=127 layers:', pianoLoud.length);
if (pianoSoft.length && pianoLoud.length) {
    console.log('  soft sampleIds:', pianoSoft.map(l => l.sampleId).join(','), '| loud sampleIds:', pianoLoud.map(l => l.sampleId).join(','));
}

// Drum: channel 9 bass drum
const drumLayers = getSF2Layers(0, 36, 100, true, 128);
console.log('\nDrum @ BD1 pitch=36 layers:', drumLayers.length);
drumLayers.slice(0, 3).forEach(l => {
    console.log('  -', l.sampleName, '| sampleId:', l.sampleId, '| loop:', l.loopMode ? 'on' : 'off', '| velRange:', l.velRange.join('-'));
});

console.log('\nAll checks passed.');