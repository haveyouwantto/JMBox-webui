import PicoAudio from 'picoaudio';

const picoAudio = new PicoAudio();
picoAudio.init();
picoAudio.settings.preserveSmfData = true

let soundfontLoaded = false;
export function loadSoundfont() {
    if (!soundfontLoaded) {
        fetch('soundfont.bin').then(r => {
            if (r.ok) return r.arrayBuffer()
        }).then(b => {
            picoAudio.loadSamples(b)
            soundfontLoaded = true;
        })
    }
}

let sf2Loaded = false;
export function loadSoundFontSF2(path) {
    if (!sf2Loaded) {
        return fetch(path).then(r => {
            if (r.ok) return r.arrayBuffer()
            else throw new Error('Failed to load SF2: ' + r.statusText)
        }).then(b => {
            const ok = picoAudio.loadSF2(b)
            if (ok) {
                sf2Loaded = true;
                console.log('SF2 SoundFont loaded successfully from', path);
            }
            return ok;
        }).catch(e => {
            console.error(e);
            return false;
        });
    }
    return Promise.resolve(true);
}

export function loadMIDIUrl(url) {
    return fetch(url).then(r => {
        if (r.ok) {
            return r.arrayBuffer()
        }
        else return Promise.reject(r.statusText);
    }).then(data => {
        return loadMIDI(data)
    });
}

export function loadMIDI(buffer) {
    const parsedData = picoAudio.parseSMF(buffer);
    try {
        picoAudio.setData(parsedData);
        return parsedData;
    } catch (error) {
        console.warn(error);
        throw error;
    }
}

export async function loadWavetable(path) {
    const r = await fetch(path);
    const b = await r.arrayBuffer();
    picoAudio.loadWaves(b);
}

window.picoAudio = picoAudio;

export default picoAudio;