import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

function start() {
    let url = localStorage.getItem('serverUrl');
    if (!url.endsWith('/')) url += '/';
    const app = url ? new JMBoxApp(url) : new JMBoxApp();

    app.info().then(() => {
        const path = location.hash.slice(2);
        app.setPath(path);
        app.list(true);

        window.app = app;
    })
        .catch(() => {
            let newUrl = prompt("Enter server url:");
            if (newUrl) {
                if (!newUrl.endsWith('/')) newUrl += '/';
                localStorage.setItem('serverUrl', newUrl);
                start();
            }
        });
}


start();
