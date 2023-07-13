import { getLocale, createLocaleItem, localeList, setLocale } from '../locale';
import { saveSettings } from '../settings';
import version from '../version';
import * as dialog from './dialog'

export function aboutDialog() {
    dialog.clear();
    dialog.setTitle(getLocale('about.title'));
    dialog.addText('<a href="https://github.com/haveyouwantto/JMBox" class="link">JMBox</a> ' + getLocale("about.name"));
    dialog.addText(getLocale("about.version") + " " + version);
    dialog.addText("\u00a9 2023 haveyouwantto");
    dialog.addText("Licensed under MIT License.");

    let section = document.createElement("a");
    section.classList.add('dialog-subtitle');
    section.innerText = getLocale("about.libraries");
    dialog.addElement(section);
    dialog.addText('<a href="https://github.com/cagpie/PicoAudio.js" class="link">PicoAudio</a> \u00a9 cagpie (MIT License)');
    dialog.setVisible(true);
}

export function languageDialog() {
    dialog.clear();
    dialog.setTitleElement(createLocaleItem('languages.title'));

    let item = dialog.createDialogItem(null, true);
    item.classList.add('button-flash');
    item.appendChild(createLocaleItem('languages.auto'));
    item.addEventListener('click', e => {
        setLocale(navigator.language);
        settings.language = "auto";
        saveSettings();
    });
    dialog.addElement(item);

    for (let language in localeList) {
        let item = dialog.createDialogItem(localeList[language], true);
        item.classList.add('button-flash');
        item.addEventListener('click', e => {
            setLocale(language);
            settings.language = language;
            saveSettings();
        });
        dialog.addElement(item);
    }
    dialog.setVisible(true);
}