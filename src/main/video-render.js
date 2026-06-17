
import { MidiFall, WebGLRenderer } from "./ui/waterfall";
import picoAudio from "./picoaudio";
import { renderAudio } from "./wav-render";

async function getBestWebCodecsConfig(width = 1920, height = 1080) {
    // 1. 定义视频编码优先级列表 (严格符合 WebCodecs 规范的 codec 字符串)
    const videoCodecs = [
        { name: 'AV1', codec: 'av01.0.05M.08' },          // AV1 Main Profile, level 3.0
        { name: 'HEVC', codec: 'hvc1.1.6.L120.90' },      // HEVC Main Profile, Main Tier, Level 4.0
        { name: 'H264', codec: 'avc1.4d002a' },           // H.264 Main Profile, Level 4.2
        { name: 'VP9', codec: 'vp09.00.10.08' },          // VP9 Profile 0, 8-bit
        { name: 'VP8', codec: 'vp8' }                     // VP8
    ];

    // 2. 定义音频编码优先级列表
    const audioCodecs = [
        { name: 'FLAC', codec: 'flac' },
        { name: 'AAC', codec: 'mp4a.40.2' },              // AAC-LC
        { name: 'MP3', codec: 'mp3' },
        { name: 'Vorbis', codec: 'vorbis' },
        { name: 'Opus', codec: 'opus' },
    ];

    // 检查浏览器是否支持 WebCodecs
    if (!window.VideoEncoder || !window.AudioEncoder) {
        throw new Error("当前浏览器不支持 WebCodecs API");
    }

    let bestVideo = null;
    let bestAudio = null;

    // 3. 测试视频编码支持情况 (按优先级)
    for (const v of videoCodecs) {
        const videoConfig = {
            codec: v.codec,
            width: width,
            height: height,
            bitrate: 20_000_000
        };

        try {
            const support = await VideoEncoder.isConfigSupported(videoConfig);
            if (support.supported) {
                bestVideo = { name: v.name, codec: v.codec, config: support.config };
                break; // 找到最高优先级的支持项，跳出循环
            }
        } catch (e) {
            // 某些浏览器对不支持的格式可能会直接报错，捕获并继续
            continue;
        }
    }

    // 4. 测试音频编码支持情况 (按优先级)
    for (const a of audioCodecs) {
        const audioConfig = {
            codec: a.codec,
            numberOfChannels: 2,
            sampleRate: 48000,
            bitrate: 128000, // 128 kbps 示例
        };

        try {
            const support = await AudioEncoder.isConfigSupported(audioConfig);
            if (support.supported) {
                bestAudio = { name: a.name, codec: a.codec, config: support.config };
                break; // 找到最高优先级的支持项，跳出循环
            }
        } catch (e) {
            continue;
        }
    }

    // 返回最终匹配到的最佳组合
    return {
        video: bestVideo,
        audio: bestAudio
    };
}

// WebCodecs 名字/前缀 到 WebM Codec ID 的映射
const WEBM_CODEC_ID_MAP = {
  // --- 视频编码映射 ---
  'AV1': 'V_AV1',
  'VP9': 'V_VP9',
  'VP8': 'V_VP8',
  'H264': 'V_MPEG4/ISO/AVC', // 注意：标准 WebM 不支持，如果是 MKV 容器才支持
  'HEVC': 'V_MPEGH/ISO/HEVC', // 注意：标准 WebM 不支持

  // --- 音频编码映射 ---
  'Opus': 'A_OPUS',
  'Vorbis': 'A_VORBIS',
  'AAC': 'A_AAC',             // 注意：标准 WebM 不支持
  'FLAC': 'A_FLAC',
  'MP3': 'A_MPEG/L3'
};

export async function renderVideo(renderer, waterfallSettings, options, progressCallback) {
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
    const bitrate = 20000000; // 20Mbps

    console.log(`[VideoRender] Config: ${width}x${height} @ ${fps}fps, ${bitrate}bps`);

    let audioBuffer = null;
    if (options.audio) {
        console.log("[VideoRender] Starting Audio Rendering...");
        audioBuffer = await renderAudio((t, l) => {
            progressCallback(t / l * 0.5, l, t, 'audio'); // Audio takes 50%
        });
        console.log(`[VideoRender] Audio Rendered: ${audioBuffer.duration}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`);
    }

    // Detect codec
    let codecResult = await getBestWebCodecsConfig(width, height)
    console.log(codecResult)

    const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: {
            codec: WEBM_CODEC_ID_MAP[ codecResult.video.name],
            width,
            height,
            frameRate: fps
        },
        audio: options.audio ? {
            codec:WEBM_CODEC_ID_MAP[ codecResult.audio.name],
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels
        } : undefined
    });

    const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: e => console.error("[VideoEncoder] Error:", e)
    });

    videoEncoder.configure({
        codec: codecResult.video.codec,
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
            codec: codecResult.audio.codec,
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

    const midiFall = new renderer(canvas, waterfallSettings);

    // Patch detectSize for OffscreenCanvas
    midiFall.detectSize = function () {
        return { w: width, h: height };
    };

    midiFall.resize();
    midiFall.settings.fixedDeltaTime = 1 / fps;   // 启用固定步长
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
