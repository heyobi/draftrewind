// GitHub eşitlemesi: iki "bilgisayar" yerel bir git http-backend sunucusu üzerinden eşitlenir.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const h = require('./helpers');
const github = require('../app/core/github');
const { parseMessage } = require('../app/core/engine');

let srv;
let url;
before(async () => {
    const root = h.tmpDir('drw-git-');
    h.initBareRepo(path.join(root, 'ogrenci', 'draftrewind-tezim.git'));
    srv = await h.startGitServer(root);
    url = `http://127.0.0.1:${srv.port}/ogrenci/draftrewind-tezim.git`;
});
after(async () => {
    if (srv) await new Promise(r => srv.server.close(r));
    h.cleanup();
});

async function computer(label) {
    const p = await h.openProject({ root: h.tmpDir(`drw-${label}-`), id: 'ortak-proje', name: 'Tezim' });
    p.meta = { github: { owner: 'ogrenci', repo: 'draftrewind-tezim' } };
    return p;
}

const read = (p, rel) => fs.readFileSync(path.join(p.dir, ...rel.split('/')), 'utf8');

test('GitHub eşitleme: iki bilgisayar, ileri sarma ve ayrışan düzenlemede "(diğer cihazdan)" kopyası', async () => {
    const pc1 = await computer('pc1');
    const pc2 = await computer('pc2');

    // 1) Bilgisayar 1 ilk kez gönderir
    h.write(path.join(pc1.dir, 'tez.txt'), 'giriş bölümü');
    h.write(path.join(pc1.dir, 'kaynak.bib'), '@article{a,\n}\n');
    await pc1.snapshot();
    const r1 = await github.sync(pc1, 'token', { url });
    assert.equal(r1.pushed, true);
    assert.equal(r1.head, await pc1.head());

    // 2) Bilgisayar 2 boş klasörle bağlanır → dosyalar gelir
    const r2 = await github.sync(pc2, 'token', { url });
    assert.equal(r2.pulled, 2);
    assert.equal(read(pc2, 'tez.txt'), 'giriş bölümü');
    assert.equal(await pc2.head(), await pc1.head());

    // 3) Bilgisayar 2 düzenler, gönderir; bilgisayar 1 ileri sarar
    h.write(path.join(pc2.dir, 'kaynak.bib'), '@article{a,\n}\n@book{b,\n}\n');
    await pc2.snapshot();
    await github.sync(pc2, 'token', { url });
    const r3 = await github.sync(pc1, 'token', { url });
    assert.equal(r3.pulled, 1);
    assert.equal(r3.conflicts.length, 0);
    assert.equal(read(pc1, 'kaynak.bib'), '@article{a,\n}\n@book{b,\n}\n');

    // 4) Aynı dosya iki bilgisayarda farklı değişir
    h.write(path.join(pc1.dir, 'tez.txt'), 'giriş bölümü — bilgisayar 1 sürümü');
    h.write(path.join(pc1.dir, 'yeni1.txt'), 'sadece pc1');
    await pc1.snapshot();
    await github.sync(pc1, 'token', { url });
    h.write(path.join(pc2.dir, 'tez.txt'), 'giriş bölümü — bilgisayar 2 sürümü, daha uzun');
    await pc2.snapshot();
    const r4 = await github.sync(pc2, 'token', { url });
    const copy = 'tez (diğer cihazdan).txt';
    assert.deepEqual(r4.conflicts, [copy]);
    assert.equal(r4.pushed, true);
    // Yerel sürüm yerinde, diğer cihazınki kopya olarak eklendi, pc1'in yeni dosyası da geldi
    assert.equal(read(pc2, 'tez.txt'), 'giriş bölümü — bilgisayar 2 sürümü, daha uzun');
    assert.equal(read(pc2, copy), 'giriş bölümü — bilgisayar 1 sürümü');
    assert.equal(read(pc2, 'yeni1.txt'), 'sadece pc1');

    // Birleştirme kaydı iki ebeveynli ve kelime sayılarını taşıyor
    const head2 = await pc2.head();
    const { commit } = await git.readCommit({ fs, gitdir: pc2.gitdir, oid: head2 });
    assert.equal(commit.parent.length, 2);
    const meta = parseMessage(commit.message).meta;
    assert.equal(meta.kind, 'merge');
    assert.ok(meta.words && meta.words['tez.txt'] > 0);

    // 5) Bilgisayar 1 birleştirmeyi alır: hiçbir sürüm kaybolmadı
    await github.sync(pc1, 'token', { url });
    assert.equal(await pc1.head(), head2);
    assert.equal(read(pc1, copy), 'giriş bölümü — bilgisayar 1 sürümü');
    assert.equal(read(pc1, 'tez.txt'), 'giriş bölümü — bilgisayar 2 sürümü, daha uzun');

    // 6) Değişiklik yokken tekrar eşitleme: gönderim yok
    const r6 = await github.sync(pc1, 'token', { url });
    assert.equal(r6.pushed, false);
    assert.equal(r6.pulled, 0);
});
