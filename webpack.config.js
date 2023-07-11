const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
  entry: "./src/index.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "bundle.js",
  },
  plugins:[
    new HtmlWebpackPlugin({
      template : 'resources/index.html'
    })
  ],
  module:{
    rules:[
      {
        test: /\.js$/i,
        exclude :/node_modules/,
        use:{
          loader:"babel-loader",
          options:{
             presets:["@babel/preset-env"]
          }
        }
      },
      {
        test: /\.css$/,
        use :["style-loader", "css-loader"]
      }
    ]
  }
};
