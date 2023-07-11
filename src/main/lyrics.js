
export function extractLyrics(midiData, encoding = "UTF-8") {
    const decoder = new TextDecoder(encoding);
    const lyrics = [];
    let ord = 0;

    for (const message of midiData.messages) {
        const smfPtr = message.smfPtr;
        const smfPtrLen = message.smfPtrLen;

        if (smfPtrLen > 0) {
            const a = midiData.smfData[smfPtr], b = midiData.smfData[smfPtr + 1];
            if (a == 0xff && [1, 5].includes(b)) {
                const len = midiData.smfData[smfPtr + 2];
                let textBytes = midiData.smfData.slice(smfPtr + 3, smfPtr + 3 + len);
                lyrics.push({ "time": message.time, "tick": message.tick, "bytes": textBytes, "text": decoder.decode(textBytes).replace(/\x00/g, ''), "ord": ord++ });
            }
        }
    }
    return lyrics;
}



export class LrcDisplayer {
    constructor() {
        this.lyrics = [];
        this.index = 0;
        this.onload = null;
        this.onlyrics = null;
        this.onseek = null;
    }

    load(midiData, encoding = "UTF-8") {
        this.lyrics = extractLyrics(midiData, encoding);
        this.index = 0;
        if (this.onload != null) {
            this.onload(this.lyrics);
        }
    }

    update(t) {
        if (this.lyrics.length > 0) {
            while (true) {
                let lrc = this.lyrics[this.index];
                if (lrc == null || lrc.time > t) {
                    break;
                } else {
                    this.index++;
                    if (this.onlyrics != null) {
                        this.onlyrics(lrc);
                    }
                }
            }
        }
    }

    seek(t) {
        if (this.lyrics.length > 0) {
            let i = 0;
            while (true) {
                let lrc = this.lyrics[i];
                if (lrc == null || lrc.time > t) {
                    if (this.onseek != null) {
                        this.onseek(this.lyrics[Math.min(i, this.lyrics.length - 1)]);
                    }
                    this.index = i;
                    break;
                } else {
                    i++;
                }
            }
        }
    }

    clear() {
        this.index = 0;
        this.lyrics = [];
    }
}