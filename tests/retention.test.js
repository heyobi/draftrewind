// Geçmiş seyreltme: eski otomatik kayıtlar gider, işaretli anlar ve dosyalar kalır; nesneler temizlenir;
// diğer bilgisayar gönderilmemiş kaydı yoksa yeni zinciri benimser.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const github = require('../app/core/github');
const retention = require('../app/core/retention');

let srv;
let url;
let root;
before(async () => {
    root = h.tmpDir('drw-thin-');
    h.initBareRepo(path.join(root, 'ogrenci', 'draftrewind-thin.git'));
    srv = await h.startGitServer(root);
    url = `http://127.0.0.1:${srv.port}/ogrenci/draftrewind-thin.git`;
});
after(async () => {
    if (srv) await new Promise(r => srv.server.close(r));
    h.cleanup();
});

async function computer(label) {
    const p = await h.openProject({ root: h.tmpDir(`drw-${label}-`), id: 'thin-proje', name: 'Tezim' });
    p.meta = { github: { owner: 'ogrenci', repo: 'draftrewind-thin' } };
    return p;
}
const read = (p, rel) => fs.readFileSync(path.join(p.dir, rel), 'utf8');

test('seyreltme: aynı gün içindeki eski otomatik kayıtlar gider, yıldızlı kalır, nesneler silinir', async () => {
    const pc1 = await computer('t1');
    for (let i = 1; i <= 8; i++) {
        h.write(path.join(pc1.dir, 'tez.txt'), `sürüm ${i} ${'x'.repeat(i)}`);
        await pc1.snapshot();
    }
    h.write(path.join(pc1.dir, 'tez.txt'), 'yıldızlı sürüm');
    await pc1.snapshot({ kind: 'star', title: 'Danışmana gönderildi' });
    h.write(path.join(pc1.dir, 'tez.txt'), 'son sürüm');
    await pc1.snapshot();
    const beforeHist = await pc1.history();
    assert.equal(beforeHist.length, 10);
    const beforeSize = retention.historySize(pc1);

    // keepAllMs: 0 → "son 7 gün" korumasız; aynı güne ait kayıtlardan yalnızca en yenisi + yıldızlı kalır
    const r = await retention.thinHistory(pc1, { keepAllMs: 0 });
    assert.equal(r.removed, 8);
    const hist = await pc1.history();
    assert.equal(hist.length, 2);
    assert.equal(hist[0].title.includes('son') || hist[0].kind === 'auto', true);
    assert.equal(hist[1].kind, 'star');
    assert.equal(read(pc1, 'tez.txt'), 'son sürüm');
    // Yıldızlı sürümün içeriği hâlâ okunabilir
    const starBuf = await pc1.readAt(hist[1].oid, 'tez.txt');
    assert.equal(starBuf.toString(), 'yıldızlı sürüm');
    const afterSize = retention.historySize(pc1);
    assert.ok(afterSize.files < beforeSize.files, `nesne sayısı azalmalı: ${beforeSize.files} → ${afterSize.files}`);
    // Tekrar çalıştırınca bir şey yapmaz
    assert.equal((await retention.thinHistory(pc1, { keepAllMs: 0 })).removed, 0);
});

test('seyreltme sonrası GitHub: zorla gönderme; diğer bilgisayar gönderilmemiş kaydı yoksa yeni zinciri benimser', async () => {
    const pc1 = await computer('t2a');
    const pc2 = await computer('t2b');
    for (let i = 1; i <= 5; i++) {
        h.write(path.join(pc1.dir, 'tez.txt'), `sürüm ${i} ${'x'.repeat(i)}`);
        await pc1.snapshot();
    }
    let r = await github.sync(pc1, 'token', { url });
    pc1.meta.githubOid = r.head;
    r = await github.sync(pc2, 'token', { url });
    pc2.meta.githubOid = r.head;
    assert.equal(read(pc2, 'tez.txt'), 'sürüm 5 xxxxx');

    const thin = await retention.thinHistory(pc1, { keepAllMs: 0 });
    assert.equal(thin.removed, 4);
    r = await github.sync(pc1, 'token', { url, force: true });
    assert.equal(r.pushed, true);
    pc1.meta.githubOid = r.head;

    // pc2: her şeyi göndermişti → yeni zinciri benimser, dosyalar aynen kalır
    r = await github.sync(pc2, 'token', { url });
    assert.equal(await pc2.head(), await pc1.head());
    assert.equal(read(pc2, 'tez.txt'), 'sürüm 5 xxxxx');
    assert.equal((await pc2.history()).length, 1);

    // pc2'de kaydedilmiş ama kayıt noktası olmamış düzenleme varken de ezilmez
    h.write(path.join(pc1.dir, 'tez.txt'), 'pc1 yeni');
    await pc1.snapshot();
    r = await github.sync(pc1, 'token', { url });
    pc1.meta.githubOid = r.head;
    h.write(path.join(pc2.dir, 'tez.txt'), 'pc2 kaydetti');
    pc2.meta.githubOid = await pc2.head();
    await github.sync(pc2, 'token', { url });
    assert.equal(read(pc2, 'tez.txt'), 'pc2 kaydetti');
    assert.equal(read(pc2, 'tez (diğer cihazdan).txt'), 'pc1 yeni');
});

test('selectKeep: 7 gün tümü, 60 gün günde bir, sonra haftada bir', () => {
    const DAY = 86400000;
    const now = Date.UTC(2026, 8, 24, 12);
    const list = [];
    // Son 100 gün, günde 4 kayıt (yeniden eskiye)
    for (let d = 0; d < 100; d++) for (let k = 0; k < 4; k++) list.push({ oid: `${d}-${k}`, commit: { parent: ['x'], committer: { timestamp: (now - d * DAY - k * 3600000) / 1000 }, message: 'auto\n\nacadamiv: {"kind":"auto"}' } });
    const keep = retention.selectKeep(list, { now });
    const kept = list.filter(c => keep.has(c.oid));
    const byAge = d => kept.filter(c => Number(c.oid.split('-')[0]) === d).length;
    assert.equal(byAge(0), 4);
    assert.equal(byAge(6), 4);
    assert.equal(byAge(10), 1);
    assert.equal(byAge(59), 1);
    const old = kept.filter(c => Number(c.oid.split('-')[0]) >= 60).length;
    assert.ok(old >= 5 && old <= 7, `haftalık: ${old}`);
});
