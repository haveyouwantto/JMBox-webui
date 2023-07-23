export default class Playlist {
    #path;
    #list ;
    #index = 0;
    constructor(path, list) {
        this.#path = path;
        this.#list = list;
    }

    setPlaying(name) {
        for (let i = 0; i < this.#list.length; i++) {
            const element = this.#list[i];
            if (element.name == name) {
                this.#index = i;
                return i;
            }
        }
        this.#index = -1;
        return -1;
    }

    next() {
        this.#index++;
        if (this.#index >= this.#list.length) {
            this.#index = 0;
        }
        return this.#list[this.#index];
    }

    prev() {
        this.#index--;
        if (this.#index < 0) {
            this.#index = this.#list.length - 1;
        }
        return this.#list[this.#index];
    }

    isLast() {
        return this.#index == this.#list.length - 1;
    }

    current() {
        return this.#list[this.#index];
    }

    get path(){
        return this.#path;
    }

    get list(){
        return this.#list;
    }
}