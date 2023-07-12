export default class PathMan {
    #stack = [];

    add(dir) {
        this.#stack.push(dir);
    }
    remove() {
        this.#stack.pop();
    }
    setPath(path) {
        let dirs = path.split('/');
        this.#stack = [];
        for (let dir of dirs) {
            if (dir != '') {
                this.#stack.push(decodeURIComponent(dir));
            }
        }
    }
    home() {
        this.#stack = [];
    }
    getPath() {
        if (this.#stack.length == 0) return '';
        let path = [];
        for (let dir of this.#stack) {
            path.push(encodeURIComponent(dir))
        }
        return "/" + path.join("/");
    }
    isRoot() {
        return this.#stack.length == 0;
    }

    dirName() {
        return this.#stack[this.#stack.length - 1];
    }
}