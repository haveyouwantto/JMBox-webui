import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

const app = new JMBoxApp('http://192.168.2.33:60752/');

app.info();
const path = location.hash.slice(2);
app.setPath(path);
app.list(true);

window.app = app;