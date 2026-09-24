// `npm version` ile sürüm artınca mobil uygulamanın sürümünü de aynı yapar.
// package.json "version" yaşam döngüsü betiği tarafından çağrılır (npm önce package.json'ı günceller).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const appJsonPath = path.join(root, 'mobile-expo', 'app.json');
const j = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
j.expo.version = version;
j.expo.ios = j.expo.ios || {};
j.expo.ios.buildNumber = String(Number(j.expo.ios.buildNumber || 0) + 1);
fs.writeFileSync(appJsonPath, JSON.stringify(j, null, 2) + '\n');
console.log(`mobile-expo/app.json → version ${version}, buildNumber ${j.expo.ios.buildNumber}`);
