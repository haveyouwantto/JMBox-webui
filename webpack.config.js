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
        test: /\.json$/,
        type: "asset",
        parser: {
            dataUrlCondition: {
                maxSize: 1024
            }
        }
      },
      {
        test: /\.html$/,
        use: ["html-loader"]
      },
    ]
  }
};
