import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

const app = new JMBoxApp('http://192.168.43.1:60752/');

app.info();
app.list(true);