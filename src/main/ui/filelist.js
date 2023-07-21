import { sortName } from "../sorting";
import EventListener from "../event-listener";
import { $, toSI } from "../utils";
import { settings } from "../settings";

import * as sorting from "../sorting"

class FileList {
    #content = $("#content");
    #filelist = [];
    #events;
    #empty = $("#empty");
    #loading = $("#loading");

    constructor() {
        this.sortFunc = sortName;
        this.reversed = false;
        this.#events = new EventListener();
    }

    setFilelist(filelist) {
        this.#filelist = filelist;
    }

    setSortFunc(func) {
        if (func.startsWith("-")) {
            func = func.substr(1);
            this.reversed = true;
        } else {
            this.reversed = false;
        }
        this.sortFunc = sorting[func];
    }

    setLoading(value){
        if(value) this.#loading.style.display = 'block';
        else this.#loading.style.display = 'none';
    }

    clear() {
        this.#content.innerHTML = '';
    }

    load() {
        const files = [];
        this.clear();

        this.#filelist.sort(this.sortFunc);
        if (this.reversed) this.#filelist.reverse();

        if (this.#filelist.length > 0)
            this.#empty.style.display = "none";
        else
            this.#empty.style.display = "block";

        for (let element of this.#filelist) {
            let file = document.createElement("button");
            file.classList.add('file');
            file.setAttribute("value", element.name);

            let fileName = document.createElement('div');
            fileName.classList.add('filename');

            let icon = document.createElement('file-icon');
            fileName.appendChild(icon);
            if (element.isDir) {
                icon.innerText = "\ue016";
                file.addEventListener('click', () => this.#events.on("list", element.name));
            } else {
                icon.innerText = "\ue00a";
                file.addEventListener('click', () => this.#events.on("play", element.name));
                files.push(element);
            }
            fileName.appendChild(document.createTextNode(element.name))
            file.appendChild(fileName);

            if (settings.showInfo) {
                let props = document.createElement('div');
                props.classList.add('fileprops');

                if (element.date != null) {
                    let date = document.createElement('span');
                    date.innerText = new Date(element.date).toLocaleString();
                    date.style.float = 'left';
                    props.appendChild(date);
                }

                if (!element.isDir && element.date != null) {
                    let size = document.createElement('span');
                    size.innerText = toSI(element.size) + "B";
                    props.appendChild(size);
                }
                file.appendChild(props);
            }

            this.#content.appendChild(file);
        }
        document.documentElement.scrollTo(0, 0);
        return files;
    }

    setEventListener(event, listener) {
        this.#events.setEventListener(event, listener);
    }

    highlight(file, smooth = false) {
        let element = this.#content.querySelector(".file[value=\"" + file + "\"]");
        element.classList.remove('file-locate');
        element.scrollIntoView({ block: "center", behavior: smooth ? 'smooth' : 'instant' });
        element.classList.add('file-locate');
    }
}

const filelist = new FileList();
export { filelist };