import AudioPlayer from "./audio-player";
import PicoAudioPlayer from "./picoaudio-player";

const players = {
    "AudioPlayer": AudioPlayer,
    "PicoAudioPlayer": PicoAudioPlayer
}

export default players;