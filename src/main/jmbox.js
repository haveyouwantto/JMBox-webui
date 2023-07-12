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
import { saveSettings, settings } from "./settings";
import PicoAudioPlayer from "./player/picoaudio-player";

export class JMBoxApp {
    constructor(baseUrl) {
        this.serverName = "JMBox";
        this.themeColor = "#00796b";
        this.baseUrl = baseUrl;

        this.pathman = new PathMan();
        this.cache = new FileCache();
        this.player = new PicoAudioPlayer();
        waterfall.setPlayer(this.player)
        this.playlist = new Playlist([]);

        this.initializeListeners();
        this.initializeSettings();
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
        console.log(path, result);
        filelist.setFilelist(result);
        filelist.showInfo = settings.showInfo;

        this.playlist = new Playlist(filelist.load());
    }

    play(name) {
        const path = this.pathman.getPath() + "/" + encodeURIComponent(name);
        this.player.loadPath(this.baseUrl, path).then(() => this.player.play());
        this.playlist.setPlaying(name);
        playerBar.setSongName(name);
    }

    initializeListeners() {

        this.player.setEventListener('load', url => {
            playerBar.setDuration(this.player.duration);
        });

        this.player.setEventListener('play', () => {
            playerBar.setPaused(false);
        });

        this.player.setEventListener('pause', () => {
            playerBar.setPaused(true);
        });

        this.player.setEventListener('volumechange', volume => {
            playerBar.setVolume(Math.sqrt(volume));
            settings.volume = volume;
            saveSettings();
        });

        this.player.setEventListener('timeupdate', time => {
            playerBar.setDuration(this.player.duration);
            playerBar.setProgress(time);
            playerBar.setBufferLength(this.player.bufferLength);
        });


        playerBar.setEventListener('play', () => {
            this.player.play();
        });

        playerBar.setEventListener('pause', () => {
            this.player.pause();
        });

        playerBar.setEventListener('next', () => {
            this.play(this.playlist.next());
        });

        playerBar.setEventListener('prev', () => {
            this.play(this.playlist.prev());
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
                case 'replay':
                    this.player.replay();
                    break;

                default:
                    break;
            }
        })
        
        playerBar.setEventListener('titleclicked',()=>{
            waterfall.toggle();
        })


        filelist.setEventListener('list', name => {
            this.pathman.add(name);
            this.list();
        })

        filelist.setEventListener('play', name => {
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
                    dialog.clear();
                    dialog.setTitle('Test');
                    dialog.addText('This is a test dialog.');
                    dialog.setVisible(true);
                    break;

                default:
                    break;
            }
        })
    }

    initializeSettings() {
        this.player.volume = settings.volume;
    }
}