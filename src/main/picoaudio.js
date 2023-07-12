import PicoAudio from '../../lib/PicoAudio/dist/nodejs/picoaudio.mjs';

const picoAudio = new PicoAudio();
picoAudio.init();

let smfData = null;

export function loadMIDI(url) {
    return fetch(url).then(r => {
        if (r.ok) {
            return r.arrayBuffer()
        }
        else return Promise.reject(r.statusText);
    }).then(data => {
        const parsedData = picoAudio.parseSMF(data);
        smfData = parsedData;
        try {
            picoAudio.setData(parsedData);
            return Promise.resolve(parsedData);
        } catch (error) {
            console.warn(error);
            return Promise.reject(error);
        }
    });
}

window.picoAudio = picoAudio;

export default picoAudio;

export { smfData };