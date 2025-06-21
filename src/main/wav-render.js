import picoAudio from "./picoaudio";
import PicoAudio from 'picoaudio';

export default function renderAndDownload(progressFunc) {
    const length = picoAudio.playData.lastEventTime
    const sr = picoAudio.context.sampleRate;
    const ctx = new OfflineAudioContext(2, sr * length, sr)
    const picoAudioRender = new PicoAudio({ audioContext: ctx });
    for (let key in picoAudio.settings) picoAudioRender.settings[key] = picoAudio.settings[key];
    picoAudioRender.setGlobalReverb(picoAudio.settings.globalReverb);
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

    const bytesPerSample = 2 * 4;
    const filesize = audioBuffer.length * bytesPerSample + 44;
    console.log(bytesPerSample, filesize)

    const bytes = new ArrayBuffer(filesize);
    const view = new DataView(bytes);

    setString(view, 0, 'RIFF')
    view.setUint32(4, 36 + audioBuffer.length * bytesPerSample, true);
    setString(view, 8, 'WAVEfmt ')
    view.setUint32(16, 16, true)  // meta length

    view.setInt16(20, 3, true)   // type: pcm float
    view.setUint16(22, 2, true)   // channels
    view.setUint32(24, audioBuffer.sampleRate, true)   // sample rate
    view.setUint32(28, audioBuffer.sampleRate * bytesPerSample, true)    // byte rate
    view.setUint16(32, bytesPerSample, true)   // block align
    view.setUint16(34, 32, true)   // bits per sample

    setString(view, 36, 'data')
    view.setUint32(40, audioBuffer.length * bytesPerSample, true)   // length

    for (let i = 0; i < audioBuffer.length; i++) {
        view.setFloat32(44 + i * bytesPerSample, a[i], true)
        view.setFloat32(48 + i * bytesPerSample, b[i], true)
    }

    return bytes
}

function setString(dataView, byteOffset, string) {
    const encoder = new TextEncoder('utf-8');
    encoder.encode(string).forEach((e, i) => {
        dataView.setUint8(byteOffset + i, e)
    });
}