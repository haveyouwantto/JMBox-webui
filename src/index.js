import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

const app = new JMBoxApp();

app.info();
app.list(true);