import { $ } from "../utils";
import { EventListener } from "../event-listener";

class NavBar {
    #nav = $('#head');
    #title = $("#title");

    #homeBtn = $("#home");
    #backBtn = $("#back");
    #collapse = $("#collapse");

    #menuBtn = this.#nav.querySelector("#menu");
    #menu = $("#topMenu");

    #events;
    constructor() {
        this.#events = new EventListener();

        this.#backBtn.addEventListener('click', () => { this.#events.on('back') });
        this.#homeBtn.addEventListener('click', () => { this.#events.on('home') });

        this.#menuBtn.addEventListener('click', () => {
            this.setMenuVisibility(true);
        });


        this.#collapse.addEventListener('click', () => {
            this.setMenuVisibility(false);
        });

        this.#menu.querySelectorAll('button').forEach(element => {
            element.addEventListener('click', () => {
                this.#events.on('menuitem', element.getAttribute('func'));
                this.setMenuVisibility(false);
            })
        });
    }

    setTitle(text) {
        this.#title.textContent = text;
    }

    setHomeButtonVisibility(visible) {
        if (visible) {
            this.#homeBtn.classList.remove('hidden');
        }
        else {
            this.#homeBtn.classList.add('hidden');
        }
    }

    setBackButtonVisibility(visible) {
        if (visible) {
            this.#backBtn.classList.remove('hidden');
        }
        else {
            this.#backBtn.classList.add('hidden');
        }
    }

    setMenuVisibility(visible) {

        if (visible) {
            this.#menu.classList.add('menu-visible');
            this.#menu.classList.remove('menu-hidden');
            this.#collapse.classList.remove('hidden');
        } else {
            this.#menu.classList.remove('menu-visible');
            this.#menu.classList.add('menu-hidden');
            this.#collapse.classList.add('hidden');
        }
    }

    isMenuVisible() {
        return this.#menu.classList.contains('menu-visible');
    }

    setEventListener(event, listener) {
        this.#events.setEventListener(event, listener);
    }
}

const navbar = new NavBar();
export { navbar };