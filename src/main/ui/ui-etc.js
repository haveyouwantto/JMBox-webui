export function setDarkMode(dark) {
    let root = document.documentElement;
    switch (dark) {
        case 'unset':
            root.classList.remove('light');
            root.classList.remove('dark');
            break;
        case 'force-light':
            root.classList.add('light');
            root.classList.remove('dark');
            break;
        case 'force-dark':
            root.classList.remove('light');
            root.classList.add('dark');
            break;
    }
}