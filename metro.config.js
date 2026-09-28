const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Bundle the offline neural model as a binary asset instead of treating it as
// JavaScript. ONNX Runtime receives the resulting local asset URI at runtime.
config.resolver.assetExts = [...config.resolver.assetExts, "onnx"];

module.exports = config;
