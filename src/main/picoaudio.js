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

window.picoAudio = picoAudio;

export default picoAudio;