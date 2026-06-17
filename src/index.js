import { JMBoxApp } from "./main/jmbox";
import { serverUrlDialog } from "./main/ui/quick-dialog";
import '../resources/style.css';
import '../resources/waterfall.css';

function start() {
    let url = localStorage.getItem('serverUrl');
    if (url && !url.endsWith('/')) url += '/';
    const app = url ? new JMBoxApp(url) : new JMBoxApp();

    app.info().then(() => {
        const path = location.hash.slice(2);
        app.setPath(path);
        app.list(true);
        window.app = app;
    })
        .catch(() => {
            serverUrlDialog().then(newUrl => {
                if (newUrl) {
                    if (!newUrl.endsWith('/')) newUrl += '/';
                    localStorage.setItem('serverUrl', newUrl);
                    start();
                } else {
                    // Cancel / offline mode
                    app.enterOfflineMode();
                    window.app = app;
                }
            });
        });
}


start();
