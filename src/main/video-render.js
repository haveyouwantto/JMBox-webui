
import { MidiFall } from "./ui/waterfall";
import picoAudio from "./picoaudio";
import { renderAudio } from "./wav-render";

export async function renderVideo(waterfallSettings, options, progressCallback) {
    console.log("[VideoRender] Starting video render...", options);

    // Dynamic import webm-muxer
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');

    const handle = await window.showSaveFilePicker({
        suggestedName: (options.filename || 'video') + '.webm',
        types: [{
            description: 'Video File',
            accept: { 'video/webm': ['.webm'] },
        }],
    });

    // Create FileSystemWritableFileStream target directly for Muxer if possible, 
    // but webm-muxer expects ArrayBufferTarget or StreamTarget.
    // We can use FileSystemWritableFileStream as a sink.
    const writable = await handle.createWritable();

    const width = options.resolution * 16 / 9; // Assume 16:9
    const height = options.resolution;
    const fps = options.fps;
    const bitrate = 10000000; // 10Mbps

    console.log(`[VideoRender] Config: ${width}x${height} @ ${fps}fps, ${bitrate}bps`);

    let audioBuffer = null;
    if (options.audio) {
        console.log("[VideoRender] Starting Audio Rendering...");
        audioBuffer = await renderAudio((t, l) => {
            progressCallback(t / l * 0.5, l, t, 'audio'); // Audio takes 50%
        });
        console.log(`[VideoRender] Audio Rendered: ${audioBuffer.duration}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`);
    }

    const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
            codec: 'V_VP9',
            width,
            height,
            frameRate: fps
        },
        audio: options.audio ? {
            codec: 'A_OPUS',
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels
        } : undefined
    });

    const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: e => console.error("[VideoEncoder] Error:", e)
    });

    videoEncoder.configure({
        codec: 'vp09.00.10.08',
        width,
        height,
        bitrate,
        framerate: fps
    });

    let audioEncoder = null;
    if (options.audio) {
        audioEncoder = new AudioEncoder({
            output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
            error: e => console.error("[AudioEncoder] Error:", e)
        });
        audioEncoder.configure({
            codec: 'opus',
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
            bitrate: 128000
        });
    }

    const padding = 50;
    const canvas = new OffscreenCanvas(width + padding * 2, height);
    // MidiFall implementation calculates layout based on canvas magnitude

    // Extract background color
    let backgroundColor = '#000000';
    let element = document.getElementById('waterfall');
    while (element) {
        const style = getComputedStyle(element);
        const color = style.backgroundColor;
        // Check if not transparent (simple check for 'rgba(0, 0, 0, 0)' or 'transparent')
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
            // Check alpha channel
            const rgba = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
            if (rgba) {
                const alpha = rgba[4] !== undefined ? parseFloat(rgba[4]) : 1;
                if (alpha > 0.1) { // Assume >10% opacity is intentional background
                    if (alpha < 1) {
                        const r = parseInt(rgba[1]);
                        const g = parseInt(rgba[2]);
                        const b = parseInt(rgba[3]);
                        backgroundColor = `rgb(${r}, ${g}, ${b})`;
                    } else {
                        backgroundColor = color;
                    }
                    break;
                }
            } else {
                // rgb() or named color
                backgroundColor = color;
                break;
            }
        }
        element = element.parentElement;
    }
    waterfallSettings.backgroundColor = backgroundColor;
    console.log(`[VideoRender] Detected background color: ${waterfallSettings.backgroundColor}`);

    const midiFall = new MidiFall(canvas, waterfallSettings);

    // Patch resize for OffscreenCanvas
    midiFall.resize = function () {
        this.dpr = 1;
        this.canvas.width = width;
        this.canvas.height = height;
        this.noteWidth = this.canvas.width / 128;
        this.keyboardHeight = this.noteWidth * 9;
        this.blackKeyHeight = this.noteWidth * 5.5;
    };
    midiFall.resize();
    midiFall.setMidiData(picoAudio.playData);

    const duration = picoAudio.playData.lastEventTime;
    const totalFrames = Math.ceil(duration * fps);

    // Audio Encoding
    if (options.audio) {
        console.log("[VideoRender] Encoding Audio...");
        const channels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;

        // Let's maximize chunk size. 1 second per chunk.
        const chunkFrames = audioBuffer.sampleRate; // 1s
        for (let i = 0; i < length; i += chunkFrames) {
            const size = Math.min(chunkFrames, length - i);
            const timestamp = i / audioBuffer.sampleRate * 1000000; // microseconds

            // Prepare planar data
            const sizeBytes = size * 4;
            const buffer = new ArrayBuffer(sizeBytes * channels);
            const view = new DataView(buffer);

            for (let c = 0; c < channels; c++) {
                const chData = audioBuffer.getChannelData(c);
                const offset = c * sizeBytes;
                for (let j = 0; j < size; j++) {
                    view.setFloat32(offset + j * 4, chData[i + j], true); // Little endian
                }
            }

            const audioData = new AudioData({
                format: 'f32-planar',
                sampleRate: audioBuffer.sampleRate,
                numberOfFrames: size,
                numberOfChannels: channels,
                timestamp,
                data: buffer
            });
            audioEncoder.encode(audioData);
            audioData.close();
        }
        await audioEncoder.flush();
        console.log("[VideoRender] Audio Encoding Complete.");
    }

    // Video Encoding
    console.log(`[VideoRender] Starting Video Encoding: ${totalFrames} frames...`);
    const frameInterval = 1 / fps;
    const startRenderTime = performance.now();

    midiFall.perfmon = false;

    for (let i = 0; i < totalFrames; i++) {
        const time = i * frameInterval;
        midiFall.renderFrame(time);

        const frame = new VideoFrame(canvas, {
            timestamp: time * 1000000 // microseconds
        });

        videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();

        // Progress & Logging
        if (i % 30 === 0) {
            // Audio took 0.5. Video takes the rest 0.5?
            // If audio was skipped, video takes 1.0.
            // But if audio was enabled, base is 0.5.
            let base = options.audio ? 0.5 : 0;
            let factor = options.audio ? 0.5 : 1;

            let overallP = base + (factor * i / totalFrames);
            let elapsed = (performance.now() - startRenderTime) / 1000;
            let fpsCurrent = i / elapsed;

            // Create preview bitmap
            const bitmap = await createImageBitmap(canvas);

            progressCallback(overallP, duration, time, 'video', bitmap);

            if (i % (fps * 2) === 0) { // Log every 2 seconds of video time
                console.log(`[VideoRender] Frame ${i}/${totalFrames} (${(i / totalFrames * 100).toFixed(1)}%) ` +
                    `Q:${videoEncoder.encodeQueueSize} FPS:${fpsCurrent.toFixed(1)} Time:${time.toFixed(2)}s`);
            }
        }

        // Backpressure control
        if (i % 10 === 0) {
            if (videoEncoder.encodeQueueSize > 10) {
                console.log(`[VideoRender] Backpressure! Queue: ${videoEncoder.encodeQueueSize}. Waiting...`);
                while (videoEncoder.encodeQueueSize > 10) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
    }

    console.log("[VideoRender] Video Encoding Loop Complete. Flushing...");
    await videoEncoder.flush();
    console.log("[VideoRender] Encoder Flushed. Finalizing Muxer...");
    muxer.finalize();

    const buffer = muxer.target.buffer;
    console.log(`[VideoRender] Writing to disk... (${buffer.byteLength} bytes)`);
    await writable.write(buffer);
    await writable.close();
    console.log("[VideoRender] Done.");
}
