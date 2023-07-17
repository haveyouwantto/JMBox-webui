import FileCache from "./files/filecache";
import PathMan from "./files/pathman";
import AudioPlayer from "./player/audio-player";
import * as dialog from "./ui/dialog";
import { filelist } from "./ui/filelist";
import { navbar } from "./ui/navbar";
import * as playerBar from "./ui/player-bar";
import * as waterfall from './ui/waterfall'
import Playlist from "./player/playlist";
import { $ } from "./utils";
import { editSetting, loadSettings, settingChangeListener, settings } from "./settings";
import PicoAudioPlayer from "./player/picoaudio-player";
import { localeInit, setLocale } from "./locale";
import { aboutDialog, languageDialog, midiInfoDialog, playModeSelectionDialog } from "./ui/quick-dialog";
import { setDarkMode } from "./ui/ui-etc";
import picoAudio from "./picoaudio";
import { setSettingsDialogVisible } from "./ui/settings-dialog";

export class JMBoxApp {
    constructor(baseUrl) {
        this.serverName = "JMBox";
        this.themeColor = "#00796b";
        this.baseUrl = baseUrl;

        this.pathman = new PathMan();
        this.cache = new FileCache();
        this.player = new PicoAudioPlayer();
        waterfall.setPlayer(this.player)
        this.cwd = new Playlist([]);
        this.playlist = new Playlist([]);

        this.initializeListeners();
        loadSettings();
        localeInit();
    }

    setName(name) {
        this.serverName = name;
        navbar.setTitle(name);
        document.title = name;
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
            console.log(path, result);
            filelist.setFilelist(result);
            location.hash = path;

            this.cwd = new Playlist(path, filelist.load());
            resolve();
        })
    }

    play(name) {
        const path = this.playlist.path + "/" + encodeURIComponent(name);
        this.player.loadPath(this.baseUrl, path).then(() => this.player.play());
        this.playlist.setPlaying(name);
        playerBar.setSongName(name);
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
        playerBar.setPlayModeIcon(mode)
        editSetting('playMode', mode);
    }

    initializeListeners() {

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
            console.log(func);
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
                    playModeSelectionDialog().then(mode => {
                        this.setPlayMode(mode);
                        playerBar.setPlayModeIcon(mode);
                    });
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

        playerBar.setEventListener('playmodechange', mode => this.setPlayMode)


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
            console.log(func);
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
                case "playMode":
                    playerBar.setPlayModeIcon(e.value);
                    break;
                case "volume":
                    playerBar.setVolume(Math.sqrt(e.value));
                    break;
                case "waveType":
                    picoAudio.settings.soundQuality = e.value + 0;
                    break;
                case "language":
                    if (e.value === 'auto') setLocale(navigator.language);
                    else setLocale(e.value);
                    break;
            }
        });
    }
}