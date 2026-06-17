/**
 * IndexedDB-based MIDI file storage for browser-side persistence.
 * Stores raw ArrayBuffer data. Field format matches API: {id, name, size, date, isDir}.
 */
const DB_NAME = 'jmbox-midi-files';
const DB_VERSION = 1;
const STORE_NAME = 'midi-files';

class MidiStorage {
    constructor() {
        this.db = null;
        this._ready = this._init();
    }

    _init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDB open error:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    async _ensureReady() {
        if (!this.db) await this._ready;
    }

    /**
     * Normalize data to ArrayBuffer for storage.
     */
    _toArrayBuffer(data) {
        if (data instanceof ArrayBuffer) return data;
        if (data.buffer instanceof ArrayBuffer) return data.buffer;
        return new Uint8Array(data).buffer;
    }

    /**
     * Save a MIDI file to IndexedDB. Overwrites by name if exists.
     * @param {string} name
     * @param {ArrayBuffer|Uint8Array} data
     * @param {object} [meta] - extra fields merged into record
     * @returns {Promise<number>} record id
     */
    async save(name, data, meta = {}) {
        await this._ensureReady();
        const existing = await this._findByName(name);
        if (existing) return this.update(existing.id, name, data, meta);

        const ab = this._toArrayBuffer(data);
        const record = Object.assign({
            name,
            data: ab,
            size: ab.byteLength,
            date: Date.now()
        }, meta);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.add(record);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async update(id, name, data, meta = {}) {
        await this._ensureReady();
        const ab = this._toArrayBuffer(data);
        const record = Object.assign({
            id,
            name,
            data: ab,
            size: ab.byteLength,
            date: Date.now()
        }, meta);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(record);
            request.onsuccess = () => resolve(id);
            request.onerror = () => reject(request.error);
        });
    }

    async _findByName(name) {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const found = request.result.find(r => r.name === name);
                resolve(found || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * List metadata (no data blob). Fields match API: {id, name, size, date, isDir}.
     */
    async list() {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const list = request.result.map(r => ({
                    id: r.id,
                    name: r.name,
                    size: r.size,
                    date: r.date,
                    isDir: false
                }));
                resolve(list);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get full record by id, with data cloned to avoid detach issues.
     */
    async get(id) {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = () => {
                const record = request.result;
                if (record) {
                    if (record.data instanceof ArrayBuffer) {
                        record.data = record.data.slice(0);
                    } else if (record.data && record.data.buffer instanceof ArrayBuffer) {
                        record.data = record.data.buffer.slice(0);
                    }
                }
                resolve(record || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getByName(name) {
        const record = await this._findByName(name);
        return record ? this.get(record.id) : null;
    }

    async delete(id) {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async deleteByName(name) {
        const record = await this._findByName(name);
        if (record) return this.delete(record.id);
    }

    async clear() {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getStorageInfo() {
        const list = await this.list();
        return {
            count: list.length,
            totalSize: list.reduce((sum, f) => sum + f.size, 0)
        };
    }
}

const midiStorage = new MidiStorage();
export default midiStorage;