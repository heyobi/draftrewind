// Arayüz metinlerinde emoji taraması (ürün kuralı: emoji yok). Bulursa çıkış kodu 1.
// Kullanım: node scripts/emoji-scan.js [--lines] [dosyalar...]   (dosya verilmezse varsayılan liste)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT = [
    'app/renderer/js',
    'app/i18n/strings.js',
    'app/main.js',
    'app/core',
    'mobile-expo/App.js',
    'mobile-expo/src'
];
const args = process.argv.slice(2);
const showLines = args.includes('--lines');
const targets = args.filter(a => !a.startsWith('--'));
const RE = /\p{Extended_Pictographic}/u;

function files(p) {
    const abs = path.resolve(ROOT, p);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return [abs];
    return fs.readdirSync(abs).filter(n => /\.(js|mjs)$/.test(n)).map(n => path.join(abs, n));
}

let hits = 0;
for (const f of (targets.length ? targets : DEFAULT).flatMap(files)) {
    const found = [];
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (RE.test(l.replace(/[©®™]/g, ''))) found.push(`${i + 1}: ${l.trim().slice(0, 150)}`);
    });
    if (found.length) {
        hits += found.length;
        console.log(`== ${found.length} ${path.relative(ROOT, f)}`);
        if (showLines) console.log(found.join('\n'));
    }
}
if (hits) process.exit(1);
console.log('emoji yok');
