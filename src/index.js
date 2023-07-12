import { JMBoxApp } from "./main/jmbox";
import '../resources/style.css';
import '../resources/waterfall.css';

import picoAudio from "./main/picoaudio";

const app = new JMBoxApp('http://192.168.2.33:60752/');

app.info();
app.list(true);