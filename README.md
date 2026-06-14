# JMBox WebUI

A browser-based MIDI player with real-time waterfall visualization (inspired by the MIDI Trail/CCH powered waterfall), support for both server-side rendering and [PicoAudio](https://github.com/haveyouwantto/PicoAudio.js) synthesis, WebGL note rendering, lyrics display, dark mode, and video export.

## Features

-   **MIDI Playback** — play MIDI files from a [JMBox-Server](https://github.com/haveyouwantto/JMBox) backend, with playlist shuffle, repeat, and track navigation.
-   **Dual Players** — switch between **Server-side Render** (fast, light) and **PicoAudio Synthesizer** (high-quality Web Audio synthesis with configurable sound fonts).
-   **Waterfall / Piano Roll** — real-time 2D (Canvas2D) or 3D (WebGL/Three.js) note visualization with bloom effects, nebula, and camera controls.
-   **3D Renderer** — WebGL render mode with Three.js: per-note glow, playline effects, star particles and nebula background.
-   **Video Export** — render MIDI playback to WebM video with audio, configurable resolution and frame rate.
-   **Settings** — extensive configuration for audio, PicoAudio engine, piano roll, 3D rendering, and more.
-   **Multi-language** — locale files with dynamic UI switching.
-   **Dark Mode** — follow system, force light, or force dark.
-   **Web MIDI Output** — send MIDI events to external hardware synthesizers via Web MIDI API.
-   **Local Files** — open local MIDI files directly in the browser (note: Server-side Render is unavailable for local files).

## Quick Start

### Prerequisites

-   [Node.js](https://nodejs.org/) >= 16
-   [Git](https://git-scm.com/) (with submodule support)

### Clone & Build

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/haveyouwantto/JMBox-webui.git
cd JMBox-webui

# Build everything
bash build.sh
```

The build output is placed in `./dist`. Serve it with any static file server, or run the development server:

```bash
# Start webpack-dev-server with hot reload
npm run start
```

### Without Submodules

If you cloned without `--recurse-submodules`, the `build.sh` script will automatically initialize them. Alternatively, run manually:

```bash
git submodule update --init --recursive
```

## Development

| Command | Description |
| --- | --- |
| `npm run dev` | Webpack development build (unminified) |
| `npm run start` | Start webpack-dev-server with hot reload |
| `npm run build` | Production build to `dist/` |
| `npm run picoaudio` | Build only the PicoAudio submodule |
| `npm run fullbuild` | Build PicoAudio + JMBox (same as `build.sh` without submodule init) |

## Project Structure

```
JMBox-webui/
├── build.sh                  # Full build script (submodules + PicoAudio + JMBox)
├── webpack.config.js         # Webpack configuration
├── package.json              # Dependencies and scripts
├── resources/                # Static assets
│   ├── index.html            # Main HTML template
│   ├── manifest.json         # PWA manifest
│   ├── style.css             # Main stylesheet
│   ├── waterfall.css         # Waterfall/piano-roll styles
│   └── assets/               # Icons, fonts, etc.
├── src/
│   ├── index.js              # Entry point
│   └── main/                 # Application modules
│       ├── jmbox.js          # JMBoxApp core (routing, API, player)
│       ├── locale.js         # Multi-language support
│       ├── video-render.js   # WebM video/audio export
│       └── ui/               # UI components (waterfall, settings, etc.)
├── lib/
│   └── PicoAudio/            # Git submodule — PicoAudio.js synthesizer
└── dist/                     # Build output (generated)
```

## Dependencies

### Application

-   **[three.js](https://threejs.org/)** — WebGL rendering
-   **[webm-muxer](https://github.com/Vanilagy/webm-muxer)** — WebM video multiplexing
-   **[PicoAudio.js](https://github.com/haveyouwantto/PicoAudio.js)** — Web Audio MIDI synthesizer (submodule)
-   **[chardet](https://github.com/runk/node-chardet)** — character encoding detection

### Dev / Build

-   **[Webpack 5](https://webpack.js.org/)** with Babel, CSS/HTML/JSON loaders
-   **[terser-webpack-plugin](https://webpack.js.org/plugins/terser-webpack-plugin/)** — JS minification
-   **[css-minimizer-webpack-plugin](https://webpack.js.org/plugins/css-minimizer-webpack-plugin/)** — CSS minification
-   **[html-inline-css-webpack-plugin](https://github.com/niclasnorgren/html-inline-css-webpack-plugin)** — inline CSS into HTML

## Backend

This frontend is designed to work with [JMBox-Server](https://github.com/haveyouwantto/JMBox-Server). The server provides a REST API for browsing and streaming MIDI files. You can also open local MIDI files directly in the browser without a server (note: Server-side Render mode is unavailable for local files).

## License

MIT © [haveyouwantto](https://github.com/haveyouwantto)