import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

const app = new JMBoxApp();

app.info();
const path = location.hash.slice(1);
app.setPath(path);
app.list(true);

window.app = app;