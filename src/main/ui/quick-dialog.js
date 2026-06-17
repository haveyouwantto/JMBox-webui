import { getLocale, createLocaleItem, localeList } from '../locale';
import picoAudio from '../picoaudio';
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

/**
 * Show a dialog to enter server URL, with an option to skip for offline mode.
 * @returns {Promise<string|null>} Server URL or null for offline mode
 */
export function serverUrlDialog() {
    return new Promise((resolve, reject) => {
        dialog.clear();
        dialog.setTitle(getLocale("server-url.title") || "Server URL");

        const item = dialog.createDialogItem(null);
        item.style.display = 'flex';
        item.style.flexDirection = 'column';
        item.style.gap = '8px';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'https://example.com/';
        input.style.cssText = 'padding:8px;border-radius:4px;border:1px solid var(--border-color);width:100%;';
        item.appendChild(input);

        dialog.addElement(item);

        // Button row
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;';

        const offlineBtn = dialog.createDialogItem(getLocale("server-url.offline") || "Offline Mode", true);
        offlineBtn.classList.add('dialog-button');
        offlineBtn.addEventListener('click', () => {
            dialog.setVisible(false);
            resolve(null);
        });

        const connectBtn = dialog.createDialogItem(getLocale("server-url.connect") || "Connect", true);
        connectBtn.classList.add('dialog-button');
        connectBtn.addEventListener('click', () => {
            const url = input.value.trim();
            dialog.setVisible(false);
            resolve(url || null);
        });

        btnRow.appendChild(offlineBtn);
        btnRow.appendChild(connectBtn);
        dialog.addElement(btnRow);

        // Enter key submits
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = input.value.trim();
                dialog.setVisible(false);
                resolve(url || null);
            }
        });

        dialog.setVisible(true);
        setTimeout(() => input.focus(), 100);
    });
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

    const pd = picoAudio.playData;
    if (!pd) {
        dialog.addText(getLocale("midi-info.failed"));
        dialog.setVisible(true);
        return;
    }

    let notes = pd.channels.reduce((prev, cur) => prev + cur.notes.length, 0);
    const trackCount = pd.channels.length;

    // Basic file info
    dialog.addText(getLocale("midi-info.name") + ": " + data.name);
    dialog.addText(getLocale("midi-info.size") + ": " + toSI(data.size, true) + "B");
    dialog.addText(getLocale("midi-info.last-modified") + ": " + new Date(data.date).toLocaleString());

    // Section: MIDI Structure
    let section = document.createElement("a");
    section.classList.add('dialog-subtitle');
    section.innerText = getLocale("midi-info.structure");
    dialog.addElement(section);

    dialog.addText(getLocale("midi-info.tracks") + ": " + trackCount);
    dialog.addText(getLocale("midi-info.notes") + ": " + notes);
    dialog.addText(getLocale("midi-info.duration") + ": " + formatTime(pd.lastEventTime));

    if (pd.header) {
        dialog.addText(getLocale("midi-info.format") + ": SMF " + pd.header.format);
        dialog.addText(getLocale("midi-info.resolution") + ": " + pd.header.resolution + " ticks/beat");
    }

    // Section: Tempo
    if (pd.tempoTrack && pd.tempoTrack.length > 0) {
        section = document.createElement("a");
        section.classList.add('dialog-subtitle');
        section.innerText = getLocale("midi-info.tempo");
        dialog.addElement(section);

        const initialTempo = Math.round(pd.tempoTrack[0].value);
        dialog.addText(getLocale("midi-info.initial-tempo") + ": " + initialTempo + " BPM");

        if (pd.tempoTrack.length > 1) {
            dialog.addText(getLocale("midi-info.tempo-changes") + ": " + pd.tempoTrack.length);
            const tempos = pd.tempoTrack.map(t => t.value);
            const avgTempo = Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
            const minTempo = Math.round(Math.min(...tempos));
            const maxTempo = Math.round(Math.max(...tempos));
            dialog.addText(getLocale("midi-info.avg-tempo") + ": " + avgTempo + " BPM");
            dialog.addText(getLocale("midi-info.tempo-range") + ": " + minTempo + " ~ " + maxTempo + " BPM");
        }
    }

    // Section: SMF raw header info from smfData
    if (pd.smfData && pd.smfData.length >= 14) {
        const smf = pd.smfData;
        const rawTracks = (smf[10] << 8) | smf[11];
        if (rawTracks !== trackCount) {
            dialog.addText(getLocale("midi-info.smf-tracks") + ": " + rawTracks);
        }
    }

    dialog.setVisible(true);
}
