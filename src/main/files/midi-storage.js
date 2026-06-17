/**
 * IndexedDB-based MIDI file storage for browser-side persistence.
 * Used in no-backend mode to save opened MIDI files locally.
 * Handles large files efficiently using IndexedDB.
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
     * Save a MIDI file to IndexedDB.
     * @param {string} name - File name
     * @param {ArrayBuffer|Uint8Array} data - Raw MIDI data
     * @param {object} [meta] - Additional metadata
     * @returns {Promise<number>} The stored record ID
     */
    async save(name, data, meta = {}) {
        await this._ensureReady();

        // Check if file with same name already exists, update it
        const existing = await this._findByName(name);
        if (existing) {
            return this.update(existing.id, name, data, meta);
        }

        const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
        const record = Object.assign({
            name: name,
            data: uint8,
            size: uint8.byteLength,
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

    /**
     * Update an existing MIDI file record.
     */
    async update(id, name, data, meta = {}) {
        await this._ensureReady();
        const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer);
        const record = Object.assign({
            id: id,
            name: name,
            data: uint8,
            size: uint8.byteLength,
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

    /**
     * Find a record by file name.
     */
    async _findByName(name) {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result;
                const found = records.find(r => r.name === name);
                resolve(found || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get all stored MIDI file metadata (without the data blob for listing).
     * @returns {Promise<Array<{id: number, name: string, size: number, dateAdded: number}>>}
     */
    async list() {
        await this._ensureReady();
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result;
                // Return metadata only (no blob data) for listing
                const list = records.map(r => ({
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
     * Get a single MIDI file by ID (including the data blob).
     * @param {number} id
     * @returns {Promise<{id: number, name: string, data: Uint8Array, size: number, dateAdded: number}|null>}
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
                    // Convert stored Uint8Array data to a fresh Uint8Array copy
                    // to avoid neutered ArrayBuffer issues
                    if (record.data instanceof Uint8Array) {
                        record.data = new Uint8Array(record.data);
                    }
                }
                resolve(record || null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a MIDI file by name.
     */
    async getByName(name) {
        const record = await this._findByName(name);
        if (record) {
            return this.get(record.id);
        }
        return null;
    }

    /**
     * Delete a MIDI file by ID.
     */
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

    /**
     * Delete a MIDI file by name.
     */
    async deleteByName(name) {
        const record = await this._findByName(name);
        if (record) {
            return this.delete(record.id);
        }
    }

    /**
     * Clear all stored MIDI files.
     */
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

    /**
     * Get the total storage usage information.
     */
    async getStorageInfo() {
        await this._ensureReady();
        const list = await this.list();
        const totalSize = list.reduce((sum, f) => sum + f.size, 0);
        return {
            count: list.length,
            totalSize: totalSize
        };
    }
}

// Singleton instance
const midiStorage = new MidiStorage();
export default midiStorage;