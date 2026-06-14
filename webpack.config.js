const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const CssMinifier = require("css-minimizer-webpack-plugin");
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const JsonMinimizerPlugin = require("json-minimizer-webpack-plugin");
const HTMLInlineCSSWebpackPlugin = require("html-inline-css-webpack-plugin").default;

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].[contenthash:8].js",
    clean: true
  },
  resolve: {
    alias: {
      'picoaudio': path.resolve(__dirname, 'lib/PicoAudio/src/main.js'),
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
        exclude: /node_modules/,
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
