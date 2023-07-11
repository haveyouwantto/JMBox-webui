
/** File sorting functions */
export function sortName(a, b) {
    // Directories first
    if (a.isDir && !b.isDir) {
        return -1;
    } else if (!a.isDir && b.isDir) {
        return 1;
    }
    return a.name.localeCompare(b.name);
}

export function sortSize(a, b) {
    if (a.isDir && !b.isDir) {
        return -1;
    } else if (!a.isDir && b.isDir) {
        return 1;
    } else if (a.isDir && b.isDir) {
        return a.name.localeCompare(b.name);
    }
    return a.size - b.size;
}

export function sortMtime(a, b) {
    if (a.isDir && !b.isDir) {
        return -1;
    } else if (!a.isDir && b.isDir) {
        return 1;
    }
    return a.date - b.date;
}
