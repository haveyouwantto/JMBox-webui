import { $ } from "../utils";

class NavBar {
    #nav = $('#head');
    #title = $("#title");

    #homeBtn = $("#home");
    #backBtn = $("#back");
    #collapse = $("#collapse");

    #menuBtn = this.#nav.querySelector("#menu");
    #menu = $("#topMenu");

    constructor() {

        this.onback = () => { };
        this.onhome = () => { };

        this.#backBtn.addEventListener('click', () => { this.onback() });
        this.#homeBtn.addEventListener('click', () => { this.onhome() });

        this.#menuBtn.addEventListener('click',()=> {
            this.setMenuVisibility(true);
        });


        this.#collapse.addEventListener('click', ()=> {
            this.setMenuVisibility(false);
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
}

const navbar = new NavBar();
export { navbar };