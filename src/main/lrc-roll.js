import chardet from 'chardet';

function extractLyrics(midiData/*, encoding = "UTF-8"*/) {
    // const decoder = new TextDecoder(encoding);
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
                lyrics.push({ "time": message.time, "tick": message.tick, "bytes": textBytes,/* "text": decoder.decode(textBytes).replace(/\x00/g, ''),*/ "ord": ord++ });
            }
        }
    }
    return lyrics;
}


export default class LyricsRoll {
    #lyrics;
    #index;
    constructor() {
        this.#lyrics = [];
        this.#index = 0;
        this.onload = null;
        this.onlyrics = null;
        this.onseek = null;
    }

    load(midiData) {
        this.#lyrics = extractLyrics(midiData);
        this.#index = 0;

        const sample = this.#lyrics.reduce((e, i) => {
            if (e.length < 256) {
                var n = new Uint8Array(e.length + i.bytes.length);
                n.set(e);
                n.set(i.bytes, e.length);
                return n;
            } else return e
        }, new Uint8Array())

        const result = chardet.analyse(sample);
        let decoder = null;
        try {
            decoder = new TextDecoder(result[0].name);
        } catch (error) {
            decoder = new TextDecoder("UTF-8");
        }
        console.log(result)

        this.#lyrics.forEach(line => {
            line.text = decoder.decode(line.bytes).replace(/\x00+$/g, '')
        })

        if (this.onload != null) {
            this.onload(this.#lyrics);
        }
    }

    update(t) {
        if (this.#lyrics.length > 0) {
            while (true) {
                let lrc = this.#lyrics[this.#index];
                if (lrc == null || lrc.time > t) {
                    break;
                } else {
                    this.#index++;
                    if (this.onlyrics != null) {
                        this.onlyrics(lrc);
                    }
                }
            }
        }
    }

    seek(t) {
        if (this.#lyrics.length > 0) {
            let i = 0;
            while (true) {
                let lrc = this.#lyrics[i];
                if (lrc == null || lrc.time > t) {
                    if (this.onseek != null) {
                        this.onseek(this.#lyrics[Math.min(i, this.#lyrics.length - 1)]);
                    }
                    this.#index = i;
                    break;
                } else {
                    i++;
                }
            }
        }
    }

    clear() {
        this.#index = 0;
        this.#lyrics = [];
    }
}