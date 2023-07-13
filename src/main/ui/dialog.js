import { $ } from "../utils";


const dialog = $("#common-dialog");
const closeDialogButton = $("#close-dialog-button");
const dialogTitle = dialog.querySelector('.title');
const dialogContent = dialog.querySelector('.dialog-container');


dialog.addEventListener('animationend', function () {
    if (dialog.classList.contains('fade-out')) {
        dialog.classList.remove('fade-out')
        dialog.close();
    }
});


closeDialogButton.addEventListener('click', () => {
    dialog.classList.add('fade-out');
});

export function clear(){
    dialogTitle.innerText = '';
    dialogContent.innerHTML = '';
}

export function setTitle(text) {
    dialogTitle.innerText = text;
}

export function setTitleElement(e) {
    dialogTitle.innerHTML = '';
    dialogTitle.appendChild(e);
}

export function addElement(e) {
    dialogContent.appendChild(e);
}

export function addText(text) {
    addElement(createDialogItem(text));
}

export function setVisible(visible) {
    if (visible) {
        dialog.showModal();
    } else {
        dialog.classList.add('fade-out')
    }
}

export function createDialogItem(content, button = false) {
    let a = document.createElement(button ? 'button' : 'a');
    a.classList.add('dialog-item');
    if (content != null)
        a.innerHTML = content;
    return a;
}