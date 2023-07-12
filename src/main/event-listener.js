export default class EventListener {
    #events;
    constructor() {
        this.#events = {};
    }
    on(eventName, eventData) {
        if (this.#events[eventName]) {
            this.#events[eventName](eventData);
        }
    }

    setEventListener(eventName, listener) {
        this.#events[eventName] = listener;
    }
}