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
            promptServerUrl(app);
        });
}

function promptServerUrl(app, errorMsg) {
    serverUrlDialog(errorMsg).then(newUrl => {
        if (newUrl) {
            if (!newUrl.endsWith('/')) newUrl += '/';
            localStorage.setItem('serverUrl', newUrl);
            const newApp = new JMBoxApp(newUrl);
            newApp.info().then(() => {
                const path = location.hash.slice(2);
                newApp.setPath(path);
                newApp.list(true);
                window.app = newApp;
            }).catch(() => {
                setTimeout(() => {
                    localStorage.removeItem('serverUrl');
                promptServerUrl(newApp, 'Failed to connect to server');
                }, 1000);
            });
        } else {
            app.enterOfflineMode();
            window.app = app;
        }
    });
}


start();
