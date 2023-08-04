import picoAudio from "./picoaudio";
import PicoAudio from '../../lib/PicoAudio/dist/nodejs/picoaudio.mjs';

export default function renderAndDownload(progressFunc) {
    const length = picoAudio.playData.lastEventTime
    const sr = picoAudio.context.sampleRate;
    const ctx = new OfflineAudioContext(2, sr * length * 2, sr)
    const picoAudioRender = new PicoAudio({ audioContext: ctx });
    for (let key in picoAudio.settings) picoAudioRender.settings[key] = picoAudio.settings[key];
    picoAudioRender.setData(picoAudio.playData);
    const interval = setInterval(() => progressFunc(picoAudioRender.context.currentTime, length), 100)
    return picoAudioRender.render().then(buffer => {
        clearInterval(interval);
        const data = generateWav(buffer)
        let blob = new Blob([data], { type: "audio/wav" });
        var new_file = URL.createObjectURL(blob);
        return new Promise((resolve, reject) => { resolve(new_file) })
    })
}



/**
 * Generate wave file from audio buffer
 * @param {AudioBuffer} audioBuffer 
 * @returns {ArrayBuffer} Wave file bytes
 */
export function generateWav(audioBuffer) {
    let a = audioBuffer.getChannelData(0), b = audioBuffer.getChannelData(1);

    const filesize = audioBuffer.length * 4 + 44;

    const bytes = new ArrayBuffer(filesize);
    const view = new DataView(bytes);

    setString(view, 0, 'RIFF')
    view.setUint32(4, filesize, true);
    setString(view, 8, 'WAVEfmt ')
    view.setUint32(16, 16, true)  // meta length

    view.setUint16(20, 1, true)   // type: pcm
    view.setUint16(22, 2, true)   // channels
    view.setUint32(24, audioBuffer.sampleRate, true)   // samplerate
    view.setUint32(28, audioBuffer.sampleRate * 2 * 2, true)    // byte rate
    view.setUint16(32, 4, true)   // block align
    view.setUint16(34, 16, true)   // bits per sample

    setString(view, 36, 'data')
    view.setUint32(40, audioBuffer.length * 2, true)   // length

    for (let i = 0; i < audioBuffer.length; i++) {
        view.setInt16(44 + i * 4, parseInt(a[i] * 32768), true)
        view.setInt16(46 + i * 4, parseInt(b[i] * 32768), true)
    }

    return bytes
}

function setString(dataView, byteOffset, string) {
    const encoder = new TextEncoder('utf-8');
    encoder.encode(string).forEach((e, i) => {
        dataView.setUint8(byteOffset + i, e)
    });
}