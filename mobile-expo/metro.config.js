// Görüntüleyici kütüphaneleri (jszip, docx-preview, SheetJS, jsdiff) uygulamayla birlikte gelir:
// assets/viewer/*.txt dosyaları JS modülü olarak değil, ham dosya (asset) olarak paketlenir.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('txt')) config.resolver.assetExts.push('txt');

module.exports = config;
