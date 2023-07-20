import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

const url = localStorage.getItem('serverUrl');
const app = url ? new JMBoxApp(url) : new JMBoxApp();

app.info();
const path = location.hash.slice(2);
app.setPath(path);
app.list(true);

window.app = app;