import { sortName } from "../sorting";
import { EventListener } from "../event-listener";
import { $, toSI } from "../utils";

class FileList {
    #content = $("#content");
    #filelist = [];
    #events;

    constructor() {
        this.sortFunc = sortName;
        this.showInfo = false;
        this.reversed = false;
        this.#events = new EventListener();
    }

    setFilelist(filelist) {
        this.#filelist = filelist;
    }

    load() {
        const files =[];
        this.#content.innerHTML = '';

        this.#filelist.sort(this.sortFunc);
        if (this.reversed) this.#filelist.reverse();

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
                file.addEventListener('click',()=>this.#events.on("list",element.name));
            } else {
                icon.innerText = "\ue00a";
                file.addEventListener('click',()=>this.#events.on("play",element.name));
                files.push(element.name);
            }
            fileName.appendChild(document.createTextNode(element.name))
            file.appendChild(fileName);

            if (this.showInfo) {
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
        document.documentElement.scrollTo(0,0);
        return files;
    }

    setEventListener(event, listener) {
        this.#events.setEventListener(event, listener);
    }
}

const filelist = new FileList();
export { filelist };