import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

function start(){
    let url = localStorage.getItem('serverUrl');
    if (!url.endsWith('/')) url += '/';
    const app = url ? new JMBoxApp(url) : new JMBoxApp();

    app.info().then(()=>{
        const path = location.hash.slice(2);
        app.setPath(path);
        app.list(true);

        window.app = app;
    })
    .catch(()=>{
        const newUrl = prompt("Enter server url:");
        localStorage.setItem('serverUrl', newUrl);
        if (newUrl) {
            start();
        }
    });
}


start();
