import { $ } from "../utils";
import EventListener from "../event-listener";

class NavBar {
    #nav = $('#head');
    #title = $("#title");

    #homeBtn = $("#home");
    #backBtn = $("#back");
    #collapse = $("#collapse");

    #menuBtn = this.#nav.querySelector("#menu");
    #menu = $("#topMenu");

    #filter = $('#filter')
    #filterInput = $('#filter-input')
    #close = $('#close');

    #backBtnVisible = false;

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

        this.#filter.addEventListener('click', () => {
            this.#events.on('filteropen', this.#filterInput.value)
            this.setFilterVisibility(true)
        })

        this.#filterInput.addEventListener('input', e => {
            this.#events.on('filter', this.#filterInput.value)
            e.stopPropagation();
        })

        this.#close.addEventListener('click', () => {
            this.#events.on('filterclose')
            this.setFilterVisibility(false)
        })
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
        this.#backBtnVisible = visible;
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

    setFilterVisibility(value) {
        if (value) {
            this.#title.classList.add('hidden');
            this.#close.classList.remove('hidden');
            this.#filter.classList.add('hidden');
            this.#filterInput.classList.remove('hidden');
            if (this.#backBtnVisible) this.#backBtn.classList.add('hidden')
        } else {
            this.#title.classList.remove('hidden');
            this.#close.classList.add('hidden');
            this.#filter.classList.remove('hidden');
            this.#filterInput.classList.add('hidden');
            if (this.#backBtnVisible) this.#backBtn.classList.remove('hidden')
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