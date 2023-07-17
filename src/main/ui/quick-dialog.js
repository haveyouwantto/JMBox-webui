import { getLocale, createLocaleItem, localeList } from '../locale';
import { smfData } from '../picoaudio';
import { editSetting } from '../settings';
import { $, formatTime, toSI, updateChecker } from '../utils';
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

    function updateRadioButton(e, val) {
        const radio = e.querySelector('icon');
        if (val) {
            radio.innerText = '\ue01c';
            radio.classList.add('icon-checked');
        } else {
            radio.innerText = '\ue01b';
            radio.classList.remove('icon-checked');
        }
    }

    let item = dialog.createDialogItem(null, true);
    item.classList.add('button-flash');
    item.classList.add('language-selection');
    let check = document.createElement('icon');
    if (settings.language == 'auto') {
        check.innerText = '\ue01c';
        check.classList.add('icon-checked');
        check.setAttribute('checker', '');
    } else {
        check.innerText = '\ue01b';
    }
    item.appendChild(check);

    item.appendChild(createLocaleItem('languages.auto'));

    item.addEventListener('click', e => {
        editSetting('language', 'auto');
        $(`button.language-selection`).forEach(e1 => {
            updateRadioButton(e1, e1 == item)
        })
    });
    dialog.addElement(item);

    for (let language in localeList) {
        let item = dialog.createDialogItem(null, true);

        let check = document.createElement('icon');
        if (language == settings.language) {
            check.innerText = '\ue01c';
            check.classList.add('icon-checked');
            check.setAttribute('checker', '');
        } else {
            check.innerText = '\ue01b';
        }
        item.appendChild(check);

        item.appendChild(createLocaleItem(localeList[language]));

        item.classList.add('button-flash');
        item.classList.add('language-selection');
        item.addEventListener('click', e => {
            editSetting('language', language);
            $(`button.language-selection`).forEach(e1 => {
                updateRadioButton(e1, e1 == item)
            })
        });
        dialog.addElement(item);
    }
    dialog.setVisible(true);
}



export function playModeSelectionDialog() {
    return new Promise((resolve, reject) => {
        dialog.clear();
        dialog.setTitle(getLocale('menu.play-mode'));

        let texts = ['menu.play-mode.single', 'menu.play-mode.single-looped', 'menu.play-mode.list', 'menu.play-mode.list-looped']

        for (let i = 0; i < 4; i++) {
            let item = dialog.createDialogItem(null, true);
            item.classList.add('button-flash');

            let check = document.createElement('icon');
            if (i == settings.playMode) {
                check.innerText = '\ue01c';
                check.classList.add('icon-checked');
            } else {
                check.innerText = '\ue01b';
            }
            item.appendChild(check);

            // let icon = document.createElement('icon');
            // icon.innerText = icons[i];
            // item.appendChild(icon);
            item.appendChild(createLocaleItem(texts[i]));
            item.addEventListener('click', e => {
                dialog.setVisible(false);
                return resolve(i);
            });

            dialog.addElement(item);
        }
        dialog.setVisible(true);
    })
}

export function midiInfoDialog(data) {
    dialog.clear();
    dialog.setTitle(getLocale("midi-info.title"));

    let notes = smfData.channels.reduce((prev, cur) => prev + cur.notes.length, 0);

    dialog.addText(getLocale("midi-info.name") + ": " + data.name);
    dialog.addText(getLocale("midi-info.size") + ": " + toSI(data.size, true) + "B");
    dialog.addText(getLocale("midi-info.last-modified") + ": " + new Date(data.date).toLocaleString());
    dialog.addText(getLocale("midi-info.duration") + ": " + formatTime(smfData.lastEventTime));
    dialog.addText(getLocale("midi-info.notes") + ": " + notes);
    dialog.setVisible(true);
}