import FileCache from "./files/filecache";
import PathMan from "./files/pathman";
import * as dialog from "./ui/dialog";
import * as renderDialog from "./ui/render-dialog"
import { filelist } from "./ui/filelist";
import { navbar } from "./ui/navbar";
import * as playerBar from "./ui/player-bar";
import * as waterfall from './ui/waterfall'
import Playlist from "./player/playlist";
import { $, dbToGain, resetMIDI } from "./utils";
import { editSetting, loadSettings, settingChangeListener, settings } from "./settings";
import { createLocaleItem, localeInit, setLocale, getLocale } from "./locale";
import { aboutDialog, languageDialog, midiInfoDialog, playModeSelectionDialog } from "./ui/quick-dialog";
import { setDarkMode } from "./ui/ui-etc";
import picoAudio, { loadMIDI, loadMIDIUrl, loadSoundfont } from "./picoaudio";
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
        });
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
                if (settings.showLyrics) loadMIDIUrl(url.replace("/play/", "/midi/")).then(smfData => waterfall.lrc.load(smfData));
            } else {
                if (settings.showLyrics) waterfall.lrc.load(picoAudio.playData)
            }
        });

        this.player.setEventListener('play', () => {
            playerBar.setPaused(false);
            waterfall.startAnimation();
        });

        this.player.setEventListener('pause', () => {
            playerBar.setPaused(true);
            waterfall.endAnimation();
        });

        this.player.setEventListener('volumechange', volume => {
            editSetting('volume', volume);
        });

        this.player.setEventListener('timeupdate', time => {
            playerBar.setDuration(this.player.duration);
            playerBar.setProgress(time);
            playerBar.setBufferLength(this.player.bufferLength);
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

        waterfall.setPlayer(this.player)
        if (this.playlist) {
            this.load(this.playlist.current().name).then(() => {
                this.player.seek(playTime);
                if (!paused) this.player.play();
            });
        }

        document.querySelector('html').addEventListener('drop', e => {
            this.loadLocalFile(e.dataTransfer.files[0]);
            e.preventDefault();
        })
        document.querySelector('html').addEventListener('dragover', e => {
            e.preventDefault();
        });
    }

    loadLocalFile(file) {
        if (this.player instanceof PicoAudioPlayer) {
            const fr = new FileReader()
            fr.onload = () => {
                try {
                    loadMIDI(fr.result);
                    this.player.play()
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
            if (waterfall.isVisible()) waterfall.drawFrame();
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
                    renderDialog.setVisible(true);
                    break;
                case 'upload':
                    document.getElementById("uploader").click();
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
            waterfall.toggle();
        })

        playerBar.setEventListener('playmodechange', mode => editSetting('playMode', mode))


        filelist.setEventListener('list', name => {
            this.pathman.add(name);
            this.list();
        })

        filelist.setEventListener('play', name => {
            this.playlist = this.cwd;
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
            console.log(e);
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
                    waterfall.setLyricsVisible(e.value)
            }
            updateSettingsItem(e.key, e.value);
        });


        renderDialog.renderListener.setEventListener('start', e => {
            if (picoAudio.playData) {
                const name = this.playlist ? this.playlist.current().name : playerBar.getSongName();
                renderDialog.setStartButtonEnabled(false)
                renderDialog.setDuration(picoAudio.playData.lastEventTime)
                renderDialog.setName(name)
                renderAndDownload((time, length) => {
                    renderDialog.setProgress(Math.min(time / length, 1))
                    renderDialog.setTime(Math.min(time, length))
                }).then(blob => {
                    renderDialog.setDownload(blob, name + '.wav')
                    renderDialog.setStartButtonEnabled(true);
                    renderDialog.setName('')
                })
            }
        })

        const uploader = document.getElementById("uploader");
        uploader.addEventListener('change', e => {
            this.loadLocalFile(uploader.files[0]);
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
            navigator.mediaSession.setActionHandler('seekbackward', () => { this.player.seek(this.player.currentTime - 5) });
            navigator.mediaSession.setActionHandler('seekforward', () => { this.player.seek(this.player.currentTime + 5) });
            navigator.mediaSession.setActionHandler('seekto', action => { this.player.seek(action.seekTime) });
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