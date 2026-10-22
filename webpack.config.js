const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const CssMinifier = require("css-minimizer-webpack-plugin");
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin");
const HTMLInlineCSSWebpackPlugin = require("html-inline-css-webpack-plugin").default;

// Which PicoAudio build to bundle. Defaults to the full source build (every
// engine, features.js all true); set PICO_VARIANT=basic|wave|sf2|full to
// bundle one of the prebuilt variants from lib/PicoAudio/dist instead.
//   PowerShell: $env:PICO_VARIANT='wave'; npm run build
const picoVariant = process.env.PICO_VARIANT;
const picoAudioEntry = picoVariant && picoVariant !== 'full'
  ? path.resolve(__dirname, `lib/PicoAudio/dist/nodejs/picoaudio.${picoVariant}.mjs`)
  : path.resolve(__dirname, 'lib/PicoAudio/src/main.js');

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].[contenthash:8].js",
    clean: true
  },
  resolve: {
    alias: {
      'picoaudio': picoAudioEntry,
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'resources/index.html',
      favicon: 'resources/favicon.ico',
      inject: 'body',
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'resources/assets',
          to: ''
        }
      ]
    }),
    new MiniCssExtractPlugin({
      filename: '[name].[contenthash:8].css' // The name of the extracted CSS file
    })
  ],
  optimization: {
    minimize: true,
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        picoaudio: {
          test: /[\\/]lib[\\/]PicoAudio/,
          name: 'picoaudio',
          priority: 20,
        },
        three: {
          test: /[\\/]node_modules[\\/]three/,
          name: 'three',
          priority: 20,
        },
        webmMuxer: {
          test: /[\\/]node_modules[\\/]webm-muxer/,
          name: 'webm-muxer',
          priority: 20,
        },
      },
    },
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          format: { ascii_only: true }
        }
      }),
      new CssMinifier(),
      new JsonMinimizerPlugin(),
      new HTMLInlineCSSWebpackPlugin()
    ]
  },
  module: {
    rules: [
      {
        test: /\.js$/i,
        // lib/PicoAudio is already ES2018+ that every browser we support runs,
        // and it must stay that way: the SF2 AudioWorklet processor is shipped
        // by stringifying its own source (sf2WorkletSource), so a transform that
        // injects module-scope helpers (_wrapNativeSuper for `class extends
        // AudioWorkletProcessor`) produces a blob that throws on evaluation. The
        // worklet then never registers and every SF2 note silently falls back to
        // the DSP engine, which synthesizes on the main thread.
        exclude: /node_modules|lib[\\/]PicoAudio/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"]
          }
        }
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"]
      },
      {
        test: /\.html$/,
        use: ["html-loader"]
      },
      // JSON base64 inline loader
      {
        test: /^manifest\.json$/,
        type: "asset",
        parser: {
          dataUrlCondition: {
            maxSize: 10 * 1024 // 10KB
          }
        }
      },
    ]
  }
};
