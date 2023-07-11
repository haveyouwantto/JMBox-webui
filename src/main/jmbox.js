import { FileCache } from "./files/filecache";
import { PathMan } from "./files/pathman";
import { AudioPlayer } from "./player/audio-player";
import { dialog } from "./ui/dialog";
import { filelist } from "./ui/filelist";
import { navbar } from "./ui/navbar";
import { $ } from "./utils";

export class JMBoxApp {
    constructor() {
        this.serverName = "JMBox";
        this.themeColor = "#00796b";

        this.pathman = new PathMan();
        this.cache = new FileCache();
        this.player = new AudioPlayer($("#audio"));

        this.initializeListeners();
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
        fetch('http://192.168.2.33:60752/api/info').then(r => r.json()).then(result => {
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
            return fetch("http://192.168.2.33:60752/api/list" + path)
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
        filelist.load();
    }

    initializeListeners() {

        filelist.onlist = name => {
            this.pathman.add(name);
            this.list();
        }

        filelist.onplay = name => {
            const url = "http://192.168.2.33:60752/api/play" + this.pathman.getPath() + "/" + encodeURIComponent(name);
            this.player.load(url);
            this.player.play();
        }

        navbar.onback = () => {
            this.pathman.remove();
            this.list();
        }

        navbar.onhome = () => {
            this.pathman.home();
            this.list();
        }
    }
}