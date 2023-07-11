export class Playlist{
    #list = [];
    #index = 0;
    constructor(list){
        this.#list = list;
    }

    setPlaying(name){
        this.#index = this.#list.indexOf(name);
        return this.#index;
    }

    next(){
        this.#index++;
        if (this.#index >= this.#list.length) {
            this.#index = 0;
        }
        return this.#list[this.#index];
    }

    prev(){
        this.#index--;
        if (this.#index <0){
            this.#index = this.#list.length-1;
        }
        return this.#list[this.#index];
    }
}