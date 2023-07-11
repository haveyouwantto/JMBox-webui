import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';

const app = new JMBoxApp();

app.info();
app.list(true);