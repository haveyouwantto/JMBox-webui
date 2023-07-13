import { getLocale } from '../locale';
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