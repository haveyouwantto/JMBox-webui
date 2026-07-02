import { editSetting, settings } from "../settings";
import { $, updateChecker } from "../utils";
import { saveSF2File, loadStoredSF2IfAny, restoreDefaultSF2, getCurrentSF2Name } from "../picoaudio";
import * as dialog from './dialog';
import { getLocale } from '../locale';

const settingsDialog = $("#settings-dialog");
const closeSettingsButton = $("#close-settings-button");

const settingDialogElements = {};

export function setSettingsDialogVisible(value) {
    if (value) {
        document.documentElement.classList.add('noscroll');
        settingsDialog.classList.remove("fade-out");
        // Update current SF2 name display before showing
        const el = document.getElementById('current-sf2-name');
        if (el) el.textContent = getCurrentSF2Name();
        settingsDialog.showModal();
    } else {
        document.documentElement.classList.remove('noscroll');
        settingsDialog.classList.add("fade-out");
    }
}

$("*[setting]").forEach(element => {
    const key = element.getAttribute('key');
    const type = element.getAttribute('setting');
    settingDialogElements[key] = {
        "element": element,
        "type": type,
        "key": key
    }

    if (element.getAttribute('requireSecure') && !window.isSecureContext) {
        element.style.display = 'none';
    }

    switch (type) {
        case "toggle":
            element.addEventListener('click', e => {
                editSetting(key, !settings[key]);
            });
            break
        case "radio":
            element.addEventListener('click', e => {
                editSetting(key, element.getAttribute('value'));
            });
            break
        case "dropDown":
            const select = element.querySelector('select');
            select.addEventListener('change', e => {
                editSetting(key, select.value);
            });
            break
        case "spinner":
            const input = element.querySelector('input');
            input.addEventListener('change', e => {
                editSetting(key, parseFloat(input.value));
            });
            break
        case "string":
            const input2 = element.querySelector('input');
            input2.addEventListener('change', e => {
                editSetting(key, input2.value);
            });
            break
        case "color":
            const colorInput = element.querySelector('input[type=color]');
            colorInput.addEventListener('input', e => {
                editSetting(key, colorInput.value);
            });
            break
    }
});

export function updateSettingsItem(key, value) {
    const e = settingDialogElements[key];
    if (e) {
        switch (e.type) {
            case "toggle":
                updateChecker(e.element, value);
                break
            case "radio":
                $(`button[setting=radio][key=${key}]`).forEach(e => {
                    updateChecker(e, value == e.getAttribute('value'))
                })
                break
            case "dropDown":
                const select = e.element.querySelector('select');
                select.value = value;
                break
            case "spinner":
                const input = e.element.querySelector('input');
                input.value = value;
                break
            case "string":
                const input2 = e.element.querySelector('input');
                input2.value = value;
                break
            case "color":
                const colorInput = e.element.querySelector('input[type=color]');
                colorInput.value = value;
                break
        }
    }
}

export function setSettingItemEnabled(key, enabled) {
    const e = settingDialogElements[key].element;
    if (enabled) {
        e.style.display = 'inherit';
    } else {
        e.style.display = 'none';
    }
}

export function setDropDownItems(key, items, selected) {
    if (settingDialogElements[key].type == "dropDown") {
        const e = settingDialogElements[key].element.querySelector('select');
        e.innerHTML = '';
        items.forEach(item => {
            var option = document.createElement('option');
            option.text = item.text;
            option.value = item.value;
            e.appendChild(option);
        });
        if (selected) e.value = selected;
    }
}

settingsDialog.addEventListener('animationend', function () {
    if (settingsDialog.classList.contains('fade-out')) {
        settingsDialog.classList.remove('fade-out')
        settingsDialog.close();
    }
});

// SF2 upload handlers
const sf2Uploader = document.getElementById('sf2-uploader');
if (sf2Uploader) {
    sf2Uploader.addEventListener('change', async e => {
        const f = sf2Uploader.files && sf2Uploader.files[0];
        if (!f) return;
        const ok = await saveSF2File(f);
        if (ok) {
            const el = document.getElementById('current-sf2-name');
            if (el) el.textContent = f.name;
            dialog.clear();
            dialog.setTitle(getLocale('settings.picoaudio.sf2'));
            dialog.addText(getLocale('sf2.uploaded') + ': ' + f.name);
            dialog.setVisible(true);
        } else {
            dialog.clear();
            dialog.setTitle(getLocale('settings.picoaudio.sf2'));
            dialog.addText(getLocale('sf2.loadFailed'));
            dialog.setVisible(true);
        }
        sf2Uploader.value = '';
    });
}

const sf2UploadBtn = document.getElementById('sf2-upload-btn');
if (sf2UploadBtn && sf2Uploader) {
    sf2UploadBtn.addEventListener('click', e => {
        sf2Uploader.click();
    });
}

const restoreBtn = document.getElementById('restore-default-sf2');
if (restoreBtn) {
    restoreBtn.addEventListener('click', async e => {
        const ok = await restoreDefaultSF2();
        if (ok) {
            const el = document.getElementById('current-sf2-name');
            if (el) el.textContent = getCurrentSF2Name();
            dialog.clear();
            dialog.setTitle(getLocale('settings.picoaudio.sf2'));
            dialog.addText(getLocale('sf2.restored'));
            dialog.setVisible(true);
        } else {
            dialog.clear();
            dialog.setTitle(getLocale('settings.picoaudio.sf2'));
            dialog.addText(getLocale('sf2.restoreFailed'));
            dialog.setVisible(true);
        }
    });
}

// Try loading any stored SF2 on startup (quietly)
loadStoredSF2IfAny().then(ok => {
    const el = document.getElementById('current-sf2-name');
    if (el) el.textContent = getCurrentSF2Name();
}).catch(()=>{});

closeSettingsButton.addEventListener('click', () => {
    setSettingsDialogVisible(false);
})

// const darkModeBtn = document.querySelector("#dark > select");
// darkModeBtn.addEventListener('change', e => {
//     editSetting('dark', darkModeBtn.value);
// });

// ── Tab 切换逻辑 ──
const tabButtons = document.querySelectorAll('.settings-tab');
const tabContents = document.querySelectorAll('.settings-tab-content');

function switchSettingsTab(tabName) {
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    tabContents.forEach(content => {
        content.style.display = content.getAttribute('data-tab') === tabName ? 'block' : 'none';
    });
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        switchSettingsTab(btn.getAttribute('data-tab'));
    });
});

// 默认显示第一个 tab
if (tabButtons.length > 0) {
    switchSettingsTab(tabButtons[0].getAttribute('data-tab'));
}
