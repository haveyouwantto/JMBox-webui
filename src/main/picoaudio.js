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

let sf2Loaded = false;
let currentSF2Path = null;
export function loadSoundFontSF2(path, force = false) {
    if (sf2Loaded && !force && currentSF2Path === path) {
        return Promise.resolve(true);
    }
    return fetch(path).then(r => {
        if (r.ok) return r.arrayBuffer();
        else throw new Error('Failed to load SF2: ' + r.statusText);
    }).then(b => {
        const ok = picoAudio.loadSF2(b);
        if (ok) {
            sf2Loaded = true;
            currentSF2Path = path;
            localStorage.setItem('jmbox.currentSF2Name', path);
            console.log('SF2 SoundFont loaded successfully from', path);
        } else {
            sf2Loaded = false;
            currentSF2Path = null;
        }
        return ok;
    }).catch(e => {
        console.error(e);
        sf2Loaded = false;
        currentSF2Path = null;
        return false;
    });
}

// --- IndexedDB helpers for storing user-uploaded SF2 ---
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('jmbox-sf2', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('sf2')) {
                db.createObjectStore('sf2', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveArrayBufferToDB(arrayBuffer, name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sf2', 'readwrite');
        const store = tx.objectStore('sf2');
        const putReq = store.put({ id: 'user', name: name, data: arrayBuffer });
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
    });
}

async function getArrayBufferFromDB() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sf2', 'readonly');
        const store = tx.objectStore('sf2');
        const getReq = store.get('user');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => reject(getReq.error);
    });
}

async function clearDBEntry() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('sf2', 'readwrite');
        const store = tx.objectStore('sf2');
        const delReq = store.delete('user');
        delReq.onsuccess = () => resolve(true);
        delReq.onerror = () => reject(delReq.error);
    });
}

export async function saveSF2File(file) {
    try {
        const b = await file.arrayBuffer();
        const ok = picoAudio.loadSF2(b);
        if (ok) {
            await saveArrayBufferToDB(b, file.name);
            localStorage.setItem('jmbox.currentSF2Name', file.name);
            sf2Loaded = true;
            return true;
        }
        return false;
    } catch (e) {
        console.error('saveSF2File error', e);
        return false;
    }
}

export async function loadStoredSF2IfAny() {
    try {
        const rec = await getArrayBufferFromDB();
        if (rec && rec.data) {
            const ok = picoAudio.loadSF2(rec.data);
            if (ok) {
                sf2Loaded = true;
                localStorage.setItem('jmbox.currentSF2Name', rec.name || 'Custom SF2');
                return true;
            }
        }
    } catch (e) {
        console.warn('loadStoredSF2IfAny failed', e);
    }
    return false;
}

export async function restoreDefaultSF2() {
    try {
        await clearDBEntry();
        localStorage.removeItem('jmbox.currentSF2Name');
        // Force reload the default embedded SF2
        return loadSoundFontSF2('Neo1MGM.sf2', true);
    } catch (e) {
        console.error('restoreDefaultSF2 failed', e);
        return false;
    }
}

export function getCurrentSF2Name() {
    return localStorage.getItem('jmbox.currentSF2Name') || 'Default';
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

export async function loadWavetable(path) {
    const r = await fetch(path);
    const b = await r.arrayBuffer();
    picoAudio.loadWaves(b);
}

window.picoAudio = picoAudio;

export default picoAudio;