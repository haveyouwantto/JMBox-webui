const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const CssMinifier = require("css-minimizer-webpack-plugin");
const CopyWebpackPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: 'resources/index.html',
      favicon: 'resources/favicon.ico',
      inject: 'body'
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
      filename: 'style.css' // The name of the extracted CSS file
    })
  ],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin(), new CssMinifier()]
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
        test: /\*\.json$/,
        type: "asset/resource"
      }
    ]
  }
};
