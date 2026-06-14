#!/usr/bin/env bash
set -e

echo "==> Initializing git submodules..."
git submodule update --init --recursive

echo "==> Installing JMBox dependencies..."
npm install

echo "==> Building PicoAudio (submodule)..."
cd lib/PicoAudio
npm install
npm run build
cd ../..

echo "==> Building JMBox..."
npm run build

echo "==> Build complete! Output is in ./dist"