export class PlayerObserver {
    constructor() {
        this.onload = url => null;
        this.onplay = (time) => null;
        this.onpause = (time) => null;
        this.onseek = (duration) => null;
        this.onstop = (time) => null;
        this.onended = () => null;
        this.onerror = (e) => null;
        this.onloopchange = (volume) => null;
        this.onvolumechange = (volume) => null;
        this.ontimeupdate = (time) => null;
    }
}