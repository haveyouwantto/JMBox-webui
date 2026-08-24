import FileCache from "./files/filecache";
import PathMan from "./files/pathman";
import midiStorage from "./files/midi-storage";
import * as dialog from "./ui/dialog";
import * as renderDialog from "./ui/render-dialog"
import { filelist } from "./ui/filelist";
import { navbar } from "./ui/navbar";
import * as playerBar from "./ui/player-bar";
import { MidiFall, MidiFallController, WebGLRenderer } from './ui/waterfall'
import Playlist from "./player/playlist";
import { $, dbToGain, generatePlaylist, resetMIDI } from "./utils";
import { editSetting, loadSettings, settingChangeListener, settings } from "./settings";
import { createLocaleItem, localeInit, setLocale, getLocale } from "./locale";
import { aboutDialog, languageDialog, midiInfoDialog, playModeSelectionDialog } from "./ui/quick-dialog";
import { setDarkMode } from "./ui/ui-etc";
import picoAudio, { loadMIDI, loadMIDIUrl, loadSoundfont, loadSoundFontSF2, loadStoredSF2IfAny } from "./picoaudio";
import { Metronome } from "./metronome";
import { setDropDownItems, setSettingItemEnabled, setSettingsDialogVisible, updateSettingsItem } from "./ui/settings-dialog";
import players from "./player/player-registry";
import PicoAudioPlayer from "./player/picoaudio-player";
import renderAndDownload from "./wav-render";

export class JMBoxApp {
    constructor(baseUrl = '') {
        this.serverName = "JMBox";
        this.themeColor = "#008577";
        this.baseUrl = baseUrl;

        this.pathman = new PathMan();
        this.cache = new FileCache();

        const waterfallElement = $("#waterfall");
        const canvas = waterfallElement.querySelector('canvas');
        this.midiFall = this._createRenderer(canvas);
        this.waterfall = new MidiFallController(waterfallElement, this.midiFall, null);
        this.metronome = new Metronome({
            // 以高频采样播放进度触发，避免依赖播放器 timeupdate 的频率
            timeSource: () => (this.player ? this.player.currentTime : 0)
        });

        this.player = this.createPlayer(settings.player);
        this.cwd = null;
        this.playlist = null;
        this.midiDevices = null;
        this.initialized = false;

        this.initializeListeners();
        loadSettings();
        this.initialized = true;
    }

    setName(name) {
        this.serverName = name;
        navbar.setTitle(name);
        document.title = name;
    }

    setPath(path) {
        this.pathman.setPath(path);
    }

    setThemeColor(color) {
        this.themeColor = color;
        document.documentElement.style.setProperty('--theme-color', color);
        document.documentElement.style.setProperty('--theme-color-80', color + "80");
        document.documentElement.style.setProperty('--theme-color-60', color + "60");
        document.documentElement.style.setProperty('--theme-color-50', color + "50");
        document.documentElement.style.setProperty('--theme-color-40', color + "40");
        document.documentElement.style.setProperty('--theme-color-20', color + "20");
        // Browser metadata theme color
        $("#meta-theme-color").content = color;
    }

    info() {
        return fetch(this.baseUrl + 'api/info').then(r => r.json()).then(result => {
            this.setName(result.serverName);
            this.setThemeColor(result.themeColor);
            this.setNoPlayMode(!(result.capabilities?.play || false))
        });
    }

    setNoPlayMode(b) {
        if (b) {
            settingChangeListener.on("player", "PicoAudioPlayer");
            $("#player-section").classList.add('hidden')
            $("#audio-section").classList.add('hidden')
        } else {
            $("#player-section").classList.remove('hidden')
            $("#audio-section").classList.remove('hidden')
        }
    }

    list(ignoreCache = false, back = false) {
        if (this.pathman.isRoot()) {
            navbar.setBackButtonVisibility(false);
            navbar.setHomeButtonVisibility(false);
            navbar.setTitle(this.serverName);
        } else {
            navbar.setBackButtonVisibility(true);
            navbar.setHomeButtonVisibility(true);
            navbar.setTitle(this.pathman.dirName());
        }

        const path = this.pathman.getPath();

        if (this.cache.get(path) == null || ignoreCache) {
            filelist.clear();
            filelist.setLoading(true)
            return fetch(this.baseUrl + "api/list" + path)
                .then(response => {
                    if (response.ok) {
                        return response.json();
                    } else {
                        return Promise.reject(getLocale('browser.not-found'))
                    }
                })
                .then(result => {
                    this.updateList(path, result, back);
                    this.cache.put(path, result);
                }).catch(e => {
                    dialog.clear()
                    dialog.setTitleElement(createLocaleItem('general.error'));
                    dialog.addText(e);
                    dialog.setVisible(true);
                }).finally(() => {
                    filelist.setLoading(false);
                });
        }
        else {
            return this.updateList(path, this.cache.get(path), back);
        }
    }

    updateList(path, result, recordHistory = false) {
        if (!recordHistory) history.pushState({ page: 1 }, this.serverName, ("#!" + path));
        return new Promise((resolve, reject) => {
            filelist.clear();
            filelist.setFilelist(result);

            this.cwd = new Playlist(path, filelist.load());
            resolve();
        })
    }

    load(name) {
        const path = this.playlist.path + "/" + encodeURIComponent(name);

        this.playlist.setPlaying(name);
        playerBar.setSongName(name);
        document.title = this.serverName + " - " + name;

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata.title = name;
        }

        playerBar.setMIDIDownload(this.baseUrl, path);
        playerBar.setPlayerLoading(true)

        if (picoAudio.isWebMIDI()) resetMIDI(picoAudio.settings.WebMIDIPortOutput, true);

        return this.player.loadPath(this.baseUrl, path).finally(e => {
            playerBar.setPlayerLoading(false)
        });
    }

    play(name) {
        if (this._browsingSavedFiles) {
            const file = this.cwd.list.find(f => f.name === name);
            if (file && file.id != null) {
                this.playlist = this.cwd;
                this.playlist.setPlaying(name);
                this.loadSavedFile(file.id, name);
            }
        } else
            this.load(name).then(() => {
                this.player.play();
            }).catch(e => console.log(e));
    }

    createPlayer(name) {
        let paused = false;
        let playTime = 0;
        if (this.player) {
            paused = this.player.paused;
            playTime = this.player.currentTime;
            this.player.stop();
            delete this.player;
        }

        this.player = new players[name];
        this.setPlayMode(settings.playMode);
        this.player.volume = settings.volume;


        this.player.setEventListener('loaded', url => {
            playerBar.setDuration(this.player.duration);
            if (!(this.player instanceof PicoAudioPlayer)) {
                loadMIDIUrl(url.replace("/play/", "/midi/")).then(smfData => {
                    this.waterfall.setMidiData(smfData);
                    this.metronome.setMidiData(smfData);
                    renderDialog.setAvailable(true);
                });
            } else {
                this.waterfall.setMidiData(picoAudio.playData);
                this.metronome.setMidiData(picoAudio.playData);
                renderDialog.setAvailable(true);
            }
        });

        this.player.setEventListener('play', () => {
            playerBar.setPaused(false);
            this.waterfall.start();
        });

        this.player.setEventListener('pause', () => {
            playerBar.setPaused(true);
            this.waterfall.stop();
        });

        this.player.setEventListener('volumechange', volume => {
            editSetting('volume', volume);
        });

        this.player.setEventListener('timeupdate', time => {
            playerBar.setDuration(this.player.duration);
            playerBar.setProgress(time);
            playerBar.setBufferLength(this.player.bufferLength);
            // 节拍器按播放进度触发：只有播放时间跨过某一拍时才响
            this.metronome.update(time);
            // Seek changes fire 'timeupdate'; re-sync lyrics so they can move
            // backwards as well as forwards.
            if (this.waterfall && this.waterfall.lrc) {
                this.waterfall.lrc.seek(time);
            }
        });

        this.player.setEventListener('ended', () => {
            switch (settings.playMode) {
                case 0:
                    this.player.pause();
                    break;
                case 2:
                    if (this.playlist.isLast()) {
                        this.player.pause();
                    } else {
                        this.play(this.playlist.next().name);
                    }
                    break;
                case 3:
                    this.play(this.playlist.next().name);
                    break;
                default:
                    break;
            }
        });

        this.player.setEventListener('error', e => {
            dialog.clear()
            dialog.setTitleElement(createLocaleItem('general.error'));
            dialog.addText(e);
            // dialog.closeAfter(5000);
            dialog.setVisible(true);
        });

        this.waterfall.setPlayer(this.player)
        if (this.playlist) {
            this.load(this.playlist.current().name).then(() => {
                this.player.seek(playTime);
                // 切换播放器后让节拍器锚定到恢复播放的位置
                this.metronome.sync(playTime);
                if (!paused) this.player.play();
            });
        }

    }

    loadLocalFile(file) {
        if (this.player instanceof PicoAudioPlayer) {
            const fr = new FileReader()
            fr.onload = () => {
                try {
                    const buffer = fr.result;

                    // Save a COPY before parseSMF mutates the data, then refresh file list in offline mode
                    midiStorage.save(file.name, buffer.slice(0), {
                        date: file.lastModified
                    }).then(() => {
                        if (this._browsingSavedFiles) {
                            this.showSavedFiles();
                        }
                    }).catch(e => {
                        console.warn('Failed to save MIDI to browser storage:', e);
                    });

                    loadMIDI(buffer);
                    this.waterfall.setMidiData(picoAudio.playData);
                    this.metronome.setMidiData(picoAudio.playData, 0);
                    this.player.play();
                    renderDialog.setAvailable(true);
                } catch (error) {
                    dialog.clear()
                    dialog.setTitle(getLocale("general.error"))
                    dialog.addText(getLocale("player.failed"))
                    dialog.setVisible(true)
                }
            }
            playerBar.setSongName(file.name);
            document.title = this.serverName + " - " + file.name;
            fr.readAsArrayBuffer(file);
        }
    }

    /**
     * Enter offline mode: set title and auto-load saved files from IndexedDB.
     */
    enterOfflineMode() {
        this.setName('JMBox（离线模式）');
        this._browsingSavedFiles = true;
        this.showSavedFiles();
    }

    /**
     * Show the list of MIDI files saved in browser IndexedDB storage.
     * Used by menu item (kept for future use).
     */
    showSavedFiles() {
        this._browsingSavedFiles = true
        this.setNoPlayMode(true);
        navbar.setTitle(getLocale("title.offline"));
        midiStorage.list().then(files => {
            filelist.setLoading(false);
            filelist.clear();

            // Show as file list in main area with temporary path
            filelist.setFilelist(files);

            // Override the playlist with a virtual one pointing to saved files
            const savedPath = '#saved';
            this.cwd = new Playlist(savedPath, filelist.load());

            // Set up playback for saved files
            navbar.setBackButtonVisibility(false);
            navbar.setHomeButtonVisibility(false);
        }).catch(e => {
            console.error('Failed to list saved files:', e);
            dialog.clear();
            dialog.setTitle(getLocale("general.error"));
            dialog.addText(e.message || String(e));
            dialog.setVisible(true);
        });
    }

    /**
     * Load a MIDI file from IndexedDB by record ID.
     */
    loadSavedFile(id, name) {
        midiStorage.get(id).then(record => {
            if (!record || !record.data) {
                throw new Error('File not found in storage');
            }
            if (this.player instanceof PicoAudioPlayer) {
                loadMIDI(record.data);
                this.waterfall.setMidiData(picoAudio.playData);
                this.metronome.setMidiData(picoAudio.playData, 0);
                renderDialog.setAvailable(true);
                this.player.play();
                playerBar.setSongName(name);
                document.title = this.serverName + " - " + name;
            }
        }).catch(e => {
            console.error('Failed to load saved file:', e);
            dialog.clear();
            dialog.setTitle(getLocale("general.error"));
            dialog.addText(getLocale("player.failed"));
            dialog.setVisible(true);
        });
    }

    _createRenderer(canvas) {
        const mode = settings.rendererMode || 'webgl';
        if (mode === 'canvas2d') {
            return new MidiFall(canvas, settings);
        }
        return new WebGLRenderer(canvas, settings);
    }

    setPlayMode(mode) {
        switch (mode) {
            case 1:
                this.player.loop = true;
                break
            case 0:
            case 2:
            case 3:
                this.player.loop = false;
                break
        }
    }

    getDeviceByName(map, name) {
        for (var output of map.values()) {
            if (output.name === name) {
                return output;
            }
        }
    }
    setWebMIDI() {
        if (settings.webmidi) {
            navigator.requestMIDIAccess({ sysex: true }).then(access => {

                picoAudio.setWebMIDI(true);
                picoAudio.settings.WebMIDIWaitTime = settings.midiLatency;

                const devices = [];
                let selected = null;
                this.midiDevices = access.outputs;

                for (let device of access.outputs) {
                    devices.push({
                        text: device[1].name, value: device[1].name
                    });

                    if (device[1].name == settings.lastMidiDevice) {
                        selected = device[1].name;
                        picoAudio.settings.WebMIDIPortOutput = device[1];
                    }
                }
                setDropDownItems('lastMidiDevice', devices, selected);

                if (picoAudio.playData && !picoAudio.playData.smfData && this.player instanceof PicoAudioPlayer) {
                    let pos = this.player.currentTime;
                    this.load(this.playlist.current().name).then(() => {
                        this.player.seek(pos);
                        this.player.play();
                        // Re-set data ensuring lyrics/notes are ready
                        this.waterfall.setMidiData(picoAudio.playData);
                        this.metronome.setMidiData(picoAudio.playData, pos);
                    })
                }
            });
        } else {
            let state = picoAudio.states.isPlaying;
            picoAudio.pause();
            picoAudio.setWebMIDI(false);
            if (state)
                picoAudio.play();
        }
    }

    initializeListeners() {


        playerBar.setEventListener('play', () => {
            this.player.play();
        });

        playerBar.setEventListener('pause', () => {
            this.player.pause();
        });

        playerBar.setEventListener('next', () => {
            this.play(this.playlist.next().name);
        });

        playerBar.setEventListener('prev', () => {
            this.play(this.playlist.prev().name);
        });

        playerBar.setEventListener('volumechange', volume => {
            this.player.volume = Math.pow(volume, 2);
        });

        playerBar.setEventListener('seek', percentage => {
            this.player.seekPercentage(percentage);
            if (this.waterfall.isVisible()) this.waterfall.start();
            this.metronome.sync(this.player.duration * percentage);
        });

        playerBar.setEventListener('menuitem', func => {
            switch (func) {
                case 'locate':
                    try {
                        if (this.playlist.path == this.pathman.getPath()) {
                            filelist.highlight(this.playlist.current().name, true);
                        } else {
                            this.pathman.setPath(this.playlist.path);
                            this.list().then(() => {
                                filelist.highlight(this.playlist.current().name);
                            });
                        }
                    } catch (e) {

                    }
                    break;
                case 'midi info':
                    try {
                        midiInfoDialog(this.playlist.current());
                    } catch (e) {

                    }
                    break;
                case 'play mode':
                    playModeSelectionDialog().then(mode => editSetting('playMode', mode));
                    break;
                case 'replay':
                    this.player.replay();
                    break;

                case 'render':
                    renderDialog.checkApiAvailability();
                    renderDialog.setVisible(true);
                    if (!picoAudio.playData) {
                        renderDialog.setRendering(false); // Disable if no data
                    }
                    break;
                case 'open-local':
                    document.getElementById("uploader").click();
                    break;
                case 'saved-files':
                    this.showSavedFiles();
                    break;
                case 'full screen':
                    if (!document.fullscreenElement) {
                        document.documentElement.requestFullscreen();
                    } else {
                        if (document.exitFullscreen) {
                            document.exitFullscreen();
                        }
                    }
                    break;
                default:
                    break;
            }
        })

        playerBar.setEventListener('titleclick', () => {
            this.waterfall.toggle();
        })

        playerBar.setEventListener('playmodechange', mode => editSetting('playMode', mode))

        playerBar.setEventListener('metronome', () => {
            const position = this.player ? this.player.currentTime : 0;
            this.metronome.toggle(position);
            playerBar.setMetronomeActive(this.metronome.running);
        });


        filelist.setEventListener('list', name => {
            this.pathman.add(name);
            this.list();
        })

        filelist.setEventListener('play', name => {
            // Handle saved files from IndexedDB
            if (this._browsingSavedFiles) {
                const file = this.cwd.list.find(f => f.name === name);
                if (file && file.id != null) {
                    this.playlist = this.cwd;
                    this.playlist.setPlaying(name);
                    this.loadSavedFile(file.id, name);
                    return;
                }
            }

            if (settings.shuffle) {
                const randomList = generatePlaylist(this.cwd.list.map(f => f.name), name, 5);

                // use the order in randomList to create new playlist
                const newList = [];
                randomList.forEach(n => {
                    const item = this.cwd.list.find(f => f.name === n);
                    if (item) newList.push(item);
                });

                this.playlist = new Playlist(this.cwd.path, newList);
            } else {
                this.playlist = this.cwd;
            }

            this.play(name);
        })

        navbar.setEventListener('back', () => {
            this.pathman.remove();
            this.list();
        })

        navbar.setEventListener('home', () => {
            this.pathman.home();
            this.list();
        })

        navbar.setEventListener('menuitem', func => {
            switch (func) {
                case 'refresh':
                    this.list(true);
                    break;
                case 'about':
                    aboutDialog();
                    break;
                case 'settings':
                    setSettingsDialogVisible(true);
                    break;
                case 'languages':
                    languageDialog();
                    break;

                default:
                    break;
            }
        })
        navbar.setEventListener('filteropen', e => {
            const path = this.pathman.getPath();
            const result = this.cache.get(path).filter(f => f.name.toLowerCase().includes(e.toLowerCase()))
            this.updateList(this.cwd.path, result, true)
        })
        navbar.setEventListener('filterclose', e => {
            const path = this.pathman.getPath();
            const result = this.cache.get(path)
            this.updateList(path, result, true)
        })

        navbar.setEventListener('filter', e => {
            const path = this.pathman.getPath();
            const result = this.cache.get(path).filter(f => f.name.toLowerCase().includes(e.toLowerCase()))
            this.updateList(this.cwd.path, result, true)
        })

        settingChangeListener.setEventListener('settingchange', e => {
            switch (e.key) {
                case "dark":
                    setDarkMode(e.value);
                    break
                case "showInfo":
                    if (this.initialized) this.list();
                    break
                case "sortFunc":
                    filelist.setSortFunc(e.value);
                    if (this.initialized) this.list();
                    break
                case "player":
                    this.createPlayer(e.value);
                    break;
                case "playMode":
                    this.setPlayMode(e.value);
                    playerBar.setPlayModeIcon(e.value);
                    break;
                case "volume":
                    playerBar.setVolume(Math.sqrt(e.value));
                    break;
                case "soundQuality":
                    if (parseInt(e.value) == 3) loadSoundfont();
                    if (parseInt(e.value) == 4) {
                        // Try loading a user-stored SF2 first; fall back to the default if none.
                        loadStoredSF2IfAny().then(ok => {
                            if (!ok) {
                                // Load SF2 SoundFont from the embedded default path
                                loadSoundFontSF2('Neo1MGM.sf2');
                            }
                        });
                    }
                    picoAudio.settings.soundQuality = parseInt(e.value)
                    break;
                case "basePitch":
                    picoAudio.settings.basePitch = e.value;
                    break;
                case "maxPolyphony":
                    picoAudio.settings.maxPoly = e.value;
                    break;
                case "skipBeginning":
                    picoAudio.settings.isSkipBeginning = e.value;
                    break;
                case "skipEnding":
                    picoAudio.settings.isSkipEnding = e.value;
                    break;
                case "preGain":
                    picoAudio.settings.generateVolume = 0.15 * dbToGain(e.value);
                    break
                case "globalReverb":
                    picoAudio.setGlobalReverb(e.value);
                    break
                case "webmidi":
                    this.setWebMIDI();
                    break
                case "lastMidiDevice":
                    if (this.midiDevices) {
                        resetMIDI(picoAudio.settings.WebMIDIPortOutput, true)
                        const newDevice = this.getDeviceByName(this.midiDevices, e.value)
                        resetMIDI(newDevice)
                        picoAudio.settings.WebMIDIPortOutput = newDevice;
                    }
                    break
                case "midiLatency":
                    if (this.midiDevices)
                        picoAudio.settings.WebMIDIWaitTime = e.value;
                    break
                case "language":
                    if (e.value === 'auto') setLocale(navigator.language);
                    else setLocale(e.value);
                    break;
                case "showLyrics":
                    this.waterfall.setLyricsVisible(e.value);
                    break;
                case "rendererMode": {
                    const midiFall = this.waterfall.midiFall;
                    const currentIsWebGL = midiFall instanceof WebGLRenderer;
                    const targetIsWebGL = e.value !== 'canvas2d';
                    if (currentIsWebGL !== targetIsWebGL) {
                        const oldCanvas = midiFall.canvas;
                        const newCanvas = document.createElement('canvas');
                        newCanvas.id = oldCanvas.id;
                        newCanvas.style.cssText = oldCanvas.style.cssText;
                        oldCanvas.parentNode.replaceChild(newCanvas, oldCanvas);
                        this.waterfall.setRenderer(this._createRenderer(newCanvas));
                    }
                    break;
                }
            }
            if (this.waterfall) this.waterfall.updateSettings(settings); // Propagate settings to MidiFall
            updateSettingsItem(e.key, e.value);
        });


        renderDialog.renderListener.setEventListener('start', e => {
            if (picoAudio.playData) {
                const name = playerBar.getSongName();
                renderDialog.setRendering(true)
                renderDialog.setDuration(picoAudio.playData.lastEventTime)
                renderDialog.setName(name)

                if (renderDialog.isVideoEnabled()) {
                    import('./video-render').then(m => {
                        m.renderVideo(
                            this.waterfall.midiFall.constructor,
                            settings, {
                            audio: renderDialog.isAudioEnabled(),
                            resolution: renderDialog.getResolution(),
                            fps: renderDialog.getFps(),
                            filename: name // Pass filename
                        }, (overall, length, time, stage, bitmap) => {
                            renderDialog.setProgress(overall);

                            // Update Stage Text: e.g. (Rendering Audio...)
                            if (stage === 'audio') {
                                renderDialog.setStage(`(${getLocale('render.stage.audio')})`);
                            } else if (stage === 'video') {
                                renderDialog.setStage(`(${getLocale('render.stage.video')})`);
                            }

                            // Update Time and Preview
                            if (time !== undefined) {
                                renderDialog.setTimeProgress(Math.min(time / length, 1));
                                renderDialog.setTime(Math.min(time, length));
                            } else {
                                renderDialog.setTimeProgress(0);
                            }

                            if (bitmap) {
                                renderDialog.drawPreview(bitmap);
                                bitmap.close();
                            }

                        }).then(() => {
                            renderDialog.setRendering(false);
                            renderDialog.setName('')
                            renderDialog.setVisible(false); // Close dialog on success
                        }).catch(err => {
                            console.error(err);
                            alert(getLocale('general.error') + ": " + err);
                            renderDialog.setRendering(false);
                        });
                    });
                } else {
                    renderAndDownload((time, length) => {
                        renderDialog.setProgress(Math.min(time / length, 1))
                        renderDialog.setTime(Math.min(time, length))
                    }).then(blob => {
                        renderDialog.setDownload(blob, name + '.wav')
                        renderDialog.setRendering(false);
                        renderDialog.setName('')
                    })
                }
            }
        })

        const uploader = document.getElementById("uploader");
        uploader.addEventListener('change', e => {
            this.loadLocalFile(uploader.files[0]);
        });

        document.querySelector('html').addEventListener('drop', e => {
            this.loadLocalFile(e.dataTransfer.files[0]);
            e.preventDefault();
        });
        document.querySelector('html').addEventListener('dragover', e => {
            e.preventDefault();
        });

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                // artwork: [
                //     { src: 'favicon.ico', type: 'image/x-icon' }
                // ]
            });
            navigator.mediaSession.setActionHandler('play', () => {
                this.player.play();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                this.player.pause();
            });
            navigator.mediaSession.setActionHandler('stop', () => this.player.stop());
            navigator.mediaSession.setActionHandler('seekbackward', () => {
                const target = this.player.currentTime - 5;
                this.player.seek(target);
                this.metronome.sync(target);
            });
            navigator.mediaSession.setActionHandler('seekforward', () => {
                const target = this.player.currentTime + 5;
                this.player.seek(target);
                this.metronome.sync(target);
            });
            navigator.mediaSession.setActionHandler('seekto', action => {
                this.player.seek(action.seekTime);
                this.metronome.sync(action.seekTime);
            });
            navigator.mediaSession.setActionHandler('nexttrack', () => this.play(this.playlist.next().name));
            navigator.mediaSession.setActionHandler('previoustrack', () => this.play(this.playlist.prev().name));
        }

        window.onpopstate = event => {
            this.pathman.setPath(location.hash.slice(2));
            this.list(false, true);
        }

        // document.addEventListener("keydown", event => {
        //     switch (event.key.toLowerCase()) {
        //         case " ":
        //             event.preventDefault();
        //             if (this.player.paused) this.player.play()
        //             else this.player.pause();
        //             break;
        //         case "a":
        //             this.play(this.playlist.prev().name);
        //             event.preventDefault();
        //             break
        //         case "d":
        //             this.play(this.playlist.next().name);
        //             event.preventDefault();
        //             break
        //         default:
        //             break;
        //     }
        // });
    }
}
