import { editSetting } from "../settings";
import { $ } from "../utils";

const settingsDialog = $("#settings-dialog");

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

const darkModeBtn = document.querySelector("#dark > select");
darkModeBtn.addEventListener('change', e => {
    editSetting('dark', darkModeBtn.value);
});