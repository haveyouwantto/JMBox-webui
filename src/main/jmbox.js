import FileCache from "./files/filecache";
import PathMan from "./files/pathman";
import * as dialog from "./ui/dialog";
import { filelist } from "./ui/filelist";
import { navbar } from "./ui/navbar";
import * as playerBar from "./ui/player-bar";
import * as waterfall from './ui/waterfall'
import Playlist from "./player/playlist";
import { $ } from "./utils";
import { editSetting, loadSettings, settingChangeListener, settings } from "./settings";
import { localeInit, setLocale } from "./locale";
import { aboutDialog, languageDialog, midiInfoDialog, playModeSelectionDialog } from "./ui/quick-dialog";
import { setDarkMode } from "./ui/ui-etc";
import picoAudio, { loadMIDI, smfData } from "./picoaudio";
import { setDropDownItems, setSettingItemEnabled, setSettingsDialogVisible, updateSettingsItem } from "./ui/settings-dialog";
import players from "./player/player-registry";
import PicoAudioPlayer from "./player/picoaudio-player";

export class JMBoxApp {
    constructor(baseUrl = '') {
        this.serverName = "JMBox";
        this.themeColor = "#00796b";
        this.baseUrl = baseUrl;

        this.pathman = new PathMan();
        this.cache = new FileCache();
        this.player = this.createPlayer(settings.player);
        this.cwd = null;
        this.playlist = null;
        this.midiDevices = null;

        this.initializeListeners();
        loadSettings();
        localeInit();
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
        fetch(this.baseUrl + 'api/info').then(r => r.json()).then(result => {
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
            return fetch(this.baseUrl + "api/list" + path)
                .then(response => {
                    if (response.ok) {
                        return response.json();
                    } else {
                        dialog.setTitleElement(createLocaleItem('general.error'));
                        dialog.addText(getLocale('browser.not-found'));
                        dialog.setVisible(true);
                    }
                })
                .then(result => {
                    this.updateList(path, result, back);
                    this.cache.put(path, result);
                });
        }
        else {
            return this.updateList(path, this.cache.get(path), back);
        }
    }

    updateList(path, result, back = false) {
        return new Promise((resolve, reject) => {
            filelist.setFilelist(result);
            location.hash = path;

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

        if (!(this.player instanceof PicoAudioPlayer)) loadMIDI(this.baseUrl + "api/midi" + path);
        return this.player.loadPath(this.baseUrl, path);
    }

    play(name) {
        this.load(name).then(() => this.player.play());
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


        this.player.setEventListener('load', url => {
            playerBar.setDuration(this.player.duration);
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
        })

        waterfall.setPlayer(this.player)
        if (this.playlist) {
            this.load(this.playlist.current().name).then(() => {
                this.player.seek(playTime);
                if (!paused) this.player.play();
            });
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
                        text: device[1].name, value: device[0]
                    });

                    if (device[0] == settings.lastMidiDevice) {
                        selected = device[0];
                        picoAudio.settings.WebMIDIPortOutput = device[1];
                    }
                }
                setDropDownItems('lastMidiDevice', devices, selected);

                if (smfData && !smfData.smfData && this.player instanceof PicoAudioPlayer) {
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
                    this.list();
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

        settingChangeListener.setEventListener('settingchange', e => {
            console.log(e);
            switch (e.key) {
                case "dark":
                    setDarkMode(e.value);
                    break
                case "showInfo":
                    this.list();
                    break
                case "sortFunc":
                    filelist.setSortFunc(e.value);
                    this.list();
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
                case "waveType":
                    picoAudio.settings.soundQuality = e.value + 0;
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
                case "webmidi":
                    this.setWebMIDI();
                    break
                case "lastMidiDevice":
                    if (this.midiDevices)
                        picoAudio.settings.WebMIDIPortOutput = this.midiDevices.get(e.value);
                    break
                case "midiLatency":
                    if (this.midiDevices)
                        picoAudio.settings.WebMIDIWaitTime = e.value;
                    break
                case "language":
                    if (e.value === 'auto') setLocale(navigator.language);
                    else setLocale(e.value);
                    break;
            }
            updateSettingsItem(e.key, e.value);
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
    }
}