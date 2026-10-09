// Görüntüleyici kütüphaneleri (jszip, docx-preview, SheetJS, jsdiff) uygulamayla birlikte gelir:
// assets/viewer/*.txt dosyaları JS modülü olarak değil, ham dosya (asset) olarak paketlenir.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('txt')) config.resolver.assetExts.push('txt');

// isomorphic-git'in "pako"su yerel zlib kullanan ara katmana gider (src/git/pakoShim.js); başka hiçbir
// kütüphane (ör. jszip) etkilenmez, ara katmanın kendisi gerçek pako'yu alır.
const pakoShim = path.resolve(__dirname, 'src/git/pakoShim.js');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'pako' && /[\/]node_modules[\/]isomorphic-git[\/]/.test(context.originModulePath)) {
    return { type: 'sourceFile', filePath: pakoShim };
  }
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
