// main.js yapısı: üst düzeyden çağrılan yardımcılar registerIpc içinde kalmasın
// ("Bulutunda" › indir, importGithubRepo'ya erişemediği için hata veriyordu)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('importGithubRepo ve adoptCloudProject en üst düzeyde tanımlı', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
    assert.match(src, /^async function importGithubRepo\(/m);
    assert.match(src, /^async function adoptCloudProject\(/m);
    assert.doesNotMatch(src, /^\s+async function importGithubRepo\(/m);
});
