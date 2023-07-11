import { $ } from "../utils";

class Dialog {
    #dialog = $("#common-dialog");
    #closeDialogButton = $("#close-dialog-button");
    #dialogTitle = this.#dialog.querySelector('.title');
    #dialogContent = this.#dialog.querySelector('.dialog-container');

    constructor() {
        this.#dialogContent.innerHTML = '';

        this.#dialog.addEventListener('animationend', function () {
            if (this.#dialog.classList.contains('fade-out')) {
                this.#dialog.classList.remove('fade-out')
                this.#dialog.close();
            }
        });


        this.#closeDialogButton.addEventListener('click', () => {
            this.#dialog.classList.add('fade-out');
        });
    }

    setTitle(text) {
        this.#dialogTitle.innerText = text;
    }

    setTitleElement(e) {
        this.#dialogTitle.innerHTML = '';
        this.#dialogTitle.appendChild(e);
    }

    addElement(e) {
        this.#dialogContent.appendChild(e);
    }

    addText(text) {
        this.addElement(Dialog.createDialogItem(text));
    }

    setVisible(visible) {
        if (visible) {
            this.#dialog.showModal();
        } else {
            this.#dialog.classList.add('fade-out')
        }
    }

    static createDialogItem(content, button = false) {
        let a = document.createElement(button ? 'button' : 'a');
        a.classList.add('dialog-item');
        if (content != null)
            a.innerHTML = content;
        return a;
    }
}

const dialog = new Dialog();
export { dialog };