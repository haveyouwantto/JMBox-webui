import { editSetting, settings } from "../settings";
import { $, updateChecker } from "../utils";

const settingsDialog = $("#settings-dialog");
const closeSettingsButton = $("#close-settings-button");

const settingDialogElements = {};

export function setSettingsDialogVisible(value) {
    if (value) {
        document.documentElement.classList.add('noscroll');
        settingsDialog.classList.remove("fade-out");
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
        if(selected) e.value = selected;
    }
}

settingsDialog.addEventListener('animationend', function () {
    if (settingsDialog.classList.contains('fade-out')) {
        settingsDialog.classList.remove('fade-out')
        settingsDialog.close();
    }
});

closeSettingsButton.addEventListener('click', () => {
    setSettingsDialogVisible(false);
})

// const darkModeBtn = document.querySelector("#dark > select");
// darkModeBtn.addEventListener('change', e => {
//     editSetting('dark', darkModeBtn.value);
// });