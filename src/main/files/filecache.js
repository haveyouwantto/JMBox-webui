export default class FileCache {
    #cacheDict = {};

    get (path) {
        return this.#cacheDict[path];
    }

    put (path, content) {
       this.#cacheDict[path] = content;
    }
}