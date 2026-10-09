// Telefonun git motoru (src/git/engine.js): kayıt noktası, geçmiş, okuma, değişiklikler, onarım, yerel geçmişi aktarma.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openProject, parseMessage, ignoredPath } from '../../src/git/engine.js';
import { backendNode } from '../support/backendNode.mjs';

const require = createRequire(import.meta.url);
const h = require('../../../tests/helpers.js');
const docs = require('../../../app/core/docs.js');
after(() => h.cleanup());

const txt = (u8) => (u8 == null ? null : Buffer.from(u8).toString('utf8'));

async function phone(label = 'tel') {
  const root = h.tmpDir(`drw-${label}-`);
  const p = await openProject({ backend: backendNode(), gitdir: path.join(root, 'git', 'proje'), dir: path.join(root, 'Projeler', 'Tezim'), id: 'p1', name: 'Tezim', author: { name: 'Telefon' } });
  return { p, root, w: (rel, data) => h.write(path.join(p.dir, ...rel.split('/')), data) };
}

test('kayıt noktası → geçmiş → readAt → changes (masaüstüyle aynı kuyruk)', async () => {
  const { p, w } = await phone();
  assert.equal(await p.head(), null);
  assert.equal(await p.snapshot(), null); // boş klasör: kayıt yok

  w('tez.txt', 'bir iki üç');
  w('Bölüm 1/giriş.md', '# Giriş\n\nDört beş');
  w('veri.csv', 'a,b\n1,2\n');
  const docx = await h.makeDocx(['Birinci paragraf burada', 'İkinci paragraf']);
  w('rapor.docx', docx);
  // Yok sayılanlar
  w('.gizli', 'x');
  w('~$rapor.docx', 'kilit');
  w('geçici.tmp', 'x');
  w('_Sürümler/2026-10-08 12.00 tez.txt', 'eski kopya');
  w('.git/config', 'x');

  const s1 = await p.snapshot({ now: Date.UTC(2026, 9, 8, 10, 0, 0) });
  assert.ok(s1 && s1.oid);
  assert.deepEqual([...s1.changed].sort(), ['Bölüm 1/giriş.md', 'rapor.docx', 'tez.txt', 'veri.csv']);
  assert.deepEqual(s1.deleted, []);
  assert.equal(await p.head(), s1.oid);
  // Kelime sayıları masaüstü sayımıyla aynı
  const desk = {
    'tez.txt': await docs.countWords('tez.txt', Buffer.from('bir iki üç')),
    'Bölüm 1/giriş.md': await docs.countWords('giriş.md', Buffer.from('# Giriş\n\nDört beş')),
    'rapor.docx': await docs.countWords('rapor.docx', docx),
  };
  assert.deepEqual((await p.history())[0].words, desk);
  assert.equal(s1.total, Object.values(desk).reduce((a, b) => a + b, 0));
  assert.equal(await p.snapshot(), null); // değişiklik yok → kayıt yok

  // Düzenle + sil
  w('tez.txt', 'bir iki üç dört beş');
  fs.unlinkSync(path.join(p.dir, 'veri.csv'));
  const s2 = await p.snapshot({ now: Date.UTC(2026, 9, 8, 10, 5, 0), note: 'not' });
  assert.deepEqual(s2.changed, ['tez.txt']);
  assert.deepEqual(s2.deleted, ['veri.csv']);
  assert.equal(s2.delta['tez.txt'], 2);
  assert.equal(s2.title, 'tez güncellendi, 1 dosya silindi (+2 kelime)');

  const hist = await p.history();
  assert.equal(hist.length, 2);
  assert.equal(hist[0].oid, s2.oid);
  assert.equal(hist[0].time, Date.UTC(2026, 9, 8, 10, 5, 0));
  assert.equal(hist[0].kind, 'auto');
  assert.equal(hist[0].note, 'not');
  assert.deepEqual(hist[0].deleted, ['veri.csv']);
  assert.equal(hist[0].words['tez.txt'], 5);
  assert.equal(hist[1].author, 'Telefon');
  assert.deepEqual(hist[0].parents, [s1.oid]);
  // Masaüstü ayrıştırıcısı da aynı kuyruğu okur
  const { parseMessage: desktopParse } = require('../../../app/core/engine.js');
  const git = require('isomorphic-git');
  const { commit } = await git.readCommit({ fs, gitdir: p.gitdir, oid: s2.oid });
  const dm = desktopParse(commit.message).meta;
  assert.deepEqual(Object.keys(dm).sort(), ['changed', 'deleted', 'delta', 'kind', 'total', 'v', 'words']);
  assert.deepEqual(parseMessage(commit.message).meta, dm);

  // readAt / treeFiles
  assert.equal(txt(await p.readAt(s1.oid, 'tez.txt')), 'bir iki üç');
  assert.equal(txt(await p.readAt(s2.oid, 'tez.txt')), 'bir iki üç dört beş');
  assert.equal(await p.readAt(s2.oid, 'veri.csv'), null);
  assert.equal(txt(await p.readAt('working', 'tez.txt')), 'bir iki üç dört beş');
  assert.deepEqual([...(await p.treeFiles(s1.oid)).keys()].sort(), ['Bölüm 1/giriş.md', 'rapor.docx', 'tez.txt', 'veri.csv']);

  // changes
  const ch = await p.changes(s2.oid);
  assert.deepEqual(ch.map((r) => `${r.change}:${r.rel}`).sort(), ['deleted:veri.csv', 'modified:tez.txt']);
  assert.equal(ch.find((r) => r.rel === 'tez.txt').delta, 2);
  const ch1 = await p.changes(s1.oid);
  assert.equal(ch1.every((r) => r.change === 'added'), true);

  // Dosya filtresi
  assert.equal((await p.history({ file: 'veri.csv' })).length, 2);
  assert.equal((await p.history({ file: 'Bölüm 1/giriş.md' })).length, 1);
});

test('çok büyük dosya geçmişe girmez, atlananlar bildirilir; yok sayılan yol korunur', async () => {
  const { root } = await phone('buyuk');
  const p = await openProject({ backend: backendNode(), gitdir: path.join(root, 'g2'), dir: path.join(root, 'w2'), id: 'x', name: 'x', maxFileBytes: 1024 });
  h.write(path.join(p.dir, 'kucuk.txt'), 'küçük');
  h.write(path.join(p.dir, 'buyuk.bin'), Buffer.alloc(4096, 1));
  const s = await p.snapshot();
  assert.deepEqual(s.changed, ['kucuk.txt']);
  assert.deepEqual(s.skipped.map((x) => x.path), ['buyuk.bin']);
  assert.equal(ignoredPath('.latexmkrc'), true);
  assert.equal(ignoredPath('a/_Sürümler/x.txt'), true);
  assert.equal(ignoredPath('a/b.txt'), false);
});

test('çökme güvenliği: bozuk dal referansı günlükten onarılır', async () => {
  const { p, w } = await phone('onarim');
  w('tez.txt', 'bir');
  const s1 = await p.snapshot();
  w('tez.txt', 'bir iki');
  const s2 = await p.snapshot();
  assert.notEqual(s1.oid, s2.oid);
  const ref = path.join(p.gitdir, 'refs', 'heads', 'main');

  // Elektrik kesintisi: ref yarım yazılmış
  fs.writeFileSync(ref, s2.oid.slice(0, 17));
  const again = await openProject({ backend: backendNode(), gitdir: p.gitdir, dir: p.dir, id: 'p1', name: 'Tezim' });
  assert.equal(await again.head(), s2.oid);
  assert.equal(fs.readFileSync(ref, 'utf8').trim(), s2.oid);

  // Ref var olmayan bir nesneyi gösteriyor
  fs.writeFileSync(ref, `${'1'.repeat(40)}\n`);
  const third = await openProject({ backend: backendNode(), gitdir: p.gitdir, dir: p.dir, id: 'p1', name: 'Tezim' });
  assert.equal(await third.head(), s2.oid);
  assert.equal((await third.history()).length, 2);
  // Onarımdan sonra kayıt alınabilir ve zincir devam eder
  w('tez.txt', 'bir iki üç');
  const s3 = await third.snapshot();
  assert.deepEqual((await third.history()).map((x) => x.oid), [s3.oid, s2.oid, s1.oid]);
});

test('importLocalLog: 3 kayıt → aynı zamanlı 3 git kaydı ve doğru ağaçlar', async () => {
  const { p, root } = await phone('aktar');
  const copies = path.join(root, 'ws-history', 'Tezim');
  const copy = (rel, data) => h.write(path.join(copies, ...rel.split('/')), data);
  const t1 = Date.UTC(2026, 8, 1, 9, 0, 0);
  const t2 = Date.UTC(2026, 8, 2, 14, 30, 0);
  const t3 = Date.UTC(2026, 8, 5, 20, 15, 0);
  copy(`${encodeURIComponent('tez.txt')}/${t1}.txt`, 'bir iki');
  copy(`${encodeURIComponent('notlar.md')}/${t1}.md`, 'not');
  copy(`${encodeURIComponent('tez.txt')}/${t2}.txt`, 'bir iki üç dört');
  copy(`${encodeURIComponent('Ek/tablo.csv')}/${t3}.csv`, 'a,b');
  // loadLog sırası: yeniden eskiye
  const records = [
    { id: 'r3', time: t3, kind: 'star', title: 'Teslimden önce', changed: ['Ek/tablo.csv'], added: ['Ek/tablo.csv'], deleted: ['notlar.md'], delta: { 'notlar.md': -1 }, words: { 'tez.txt': 4 }, total: 4, files: { 'Ek/tablo.csv': `${encodeURIComponent('Ek/tablo.csv')}/${t3}.csv` } },
    { id: 'r2', time: t2, kind: 'auto', title: 'tez: 2 kelime eklendi', changed: ['tez.txt'], added: [], deleted: [], delta: { 'tez.txt': 2 }, words: { 'tez.txt': 4, 'notlar.md': 1 }, total: 5, files: { 'tez.txt': `${encodeURIComponent('tez.txt')}/${t2}.txt` } },
    { id: 'r1', time: t1, kind: 'auto', title: '', changed: ['tez.txt', 'notlar.md'], added: ['tez.txt', 'notlar.md'], deleted: [], delta: { 'tez.txt': 2, 'notlar.md': 1 }, words: { 'tez.txt': 2, 'notlar.md': 1 }, total: 3, files: { 'tez.txt': `${encodeURIComponent('tez.txt')}/${t1}.txt`, 'notlar.md': `${encodeURIComponent('notlar.md')}/${t1}.md` } },
  ];
  const readCopy = async (rec, rel) => {
    const f = path.join(copies, ...rec.files[rel].split('/'));
    return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
  };
  const res = await p.importLocalLog({ records, readCopy });
  assert.equal(res.commits.length, 3);
  assert.deepEqual(res.missing, []);
  assert.deepEqual(res.commits.map((c) => c.recordId), ['r1', 'r2', 'r3']);

  const hist = await p.history();
  assert.deepEqual(hist.map((x) => x.time), [t3, t2, t1]);
  assert.deepEqual(hist.map((x) => x.kind), ['star', 'auto', 'auto']);
  assert.equal(hist[0].title, 'Teslimden önce');
  assert.equal(hist[2].title, 'tez ve 1 dosya daha güncellendi (+3 kelime)');
  assert.deepEqual(hist[0].deleted, ['notlar.md']);
  assert.equal(hist[1].total, 5);
  const git = require('isomorphic-git');
  for (const c of res.commits) {
    const { commit } = await git.readCommit({ fs, gitdir: p.gitdir, oid: c.oid });
    assert.equal(commit.author.timestamp, c.time / 1000);
    assert.equal(commit.committer.timestamp, c.time / 1000);
  }
  // Ağaçlar
  const [c1, c2, c3] = res.commits.map((c) => c.oid);
  assert.deepEqual([...(await p.treeFiles(c1)).keys()].sort(), ['notlar.md', 'tez.txt']);
  assert.equal(txt(await p.readAt(c1, 'tez.txt')), 'bir iki');
  assert.equal(txt(await p.readAt(c2, 'tez.txt')), 'bir iki üç dört');
  assert.equal(txt(await p.readAt(c2, 'notlar.md')), 'not');
  assert.deepEqual([...(await p.treeFiles(c3)).keys()].sort(), ['Ek/tablo.csv', 'tez.txt']);
  assert.equal(await p.head(), c3);

  // Kopyası kaybolmuş dosya: önceki hali kalır, eksik olarak bildirilir
  const { p: q } = await phone('aktar2');
  const res2 = await q.importLocalLog({ records: [{ id: 'z', time: t1, changed: ['yok.txt'], files: { 'yok.txt': 'yok/1.txt' } }], readCopy: async () => null });
  assert.deepEqual(res2.missing, [{ recordId: 'z', path: 'yok.txt' }]);
});

test('iOS ayrışık (NFD) adları: geçmişe NFC yazılır, okuma/değişiklik/silme diskteki adla çalışır', async () => {
  const { p, w } = await phone('nfd');
  const nfdDir = 'Bölüm 2'.normalize('NFD');
  const nfdFile = 'Özet çalışması.txt'.normalize('NFD');
  w(`${nfdDir}/${nfdFile}`, 'ilk hali');
  const s1 = await p.snapshot();
  assert.deepEqual(s1.changed, ['Bölüm 2/Özet çalışması.txt']); // NFC
  assert.equal(txt(await p.readAt(s1.oid, 'Bölüm 2/Özet çalışması.txt')), 'ilk hali');

  w(`${nfdDir}/${nfdFile}`, 'ikinci hali daha uzun');
  const s2 = await p.snapshot();
  assert.deepEqual(s2.changed, ['Bölüm 2/Özet çalışması.txt']);
  assert.equal(txt(await p.readAt('working', 'Bölüm 2/Özet çalışması.txt')), 'ikinci hali daha uzun');
  assert.equal(txt(await p.readAt(s1.oid, 'Bölüm 2/Özet çalışması.txt')), 'ilk hali');
  assert.equal(await p.snapshot(), null); // ad farkı yüzünden sahte değişiklik yok

  fs.rmSync(path.join(p.dir, nfdDir, nfdFile));
  const s3 = await p.snapshot();
  assert.deepEqual(s3.deleted, ['Bölüm 2/Özet çalışması.txt']);
});

test('history(known): yalnızca yeni kayıtlar okunur, sonuç tam okumayla aynı; geçmiş yeniden yazılınca tam okuma', async () => {
  const { p, w } = await phone('hist');
  for (let i = 0; i < 5; i++) {
    w('a.txt', `sürüm ${i} ${'k '.repeat(i)}`);
    await p.snapshot({ now: Date.UTC(2026, 9, 8, 10, i) });
  }
  const known = await p.history({ limit: 100 });
  assert.equal(known.length, 5);
  assert.deepEqual((await p.history({ limit: 100, known })).map((x) => x.oid), known.map((x) => x.oid)); // uç değişmedi: aynı liste
  w('b.txt', 'yeni');
  await p.snapshot({ now: Date.UTC(2026, 9, 8, 11, 0) });
  const inc = await p.history({ limit: 100, known });
  const full = await p.history({ limit: 100 });
  assert.deepEqual(inc.map((x) => x.oid), full.map((x) => x.oid));
  assert.equal(inc.length, 6);
  // Uydurma (artık zincirde olmayan) eski liste: tam okumaya düşer
  const fake = [{ ...known[0], oid: 'f'.repeat(40) }, ...known.slice(1)];
  assert.deepEqual((await p.history({ limit: 100, known: fake })).map((x) => x.oid), full.map((x) => x.oid));
});

test('iCloud yer tutucusu (.Ad.icloud) silinmiş sayılmaz; okunamayan dosyanın eski hali korunur', async () => {
  const root = h.tmpDir('drw-icl-');
  let allow = true;
  const p = await openProject({ backend: backendNode(), gitdir: path.join(root, 'git'), dir: path.join(root, 'Tez'), id: 'i', name: 'Tez', prepareRead: async () => allow });
  const w = (rel, data) => h.write(path.join(p.dir, ...rel.split('/')), data);
  w('tez.docx', 'ilk');
  w('Bölüm/not.txt', 'not');
  await p.snapshot();
  // tez.docx bu cihazdan "kaldırıldı" (iCloud yalnızca yer tutucu bıraktı)
  fs.rmSync(path.join(p.dir, 'tez.docx'));
  w('.tez.docx.icloud', 'yer tutucu');
  w('Bölüm/not.txt', 'not değişti');
  const s = await p.snapshot();
  assert.deepEqual(s.deleted, []);
  assert.deepEqual(s.changed, ['Bölüm/not.txt']);
  assert.equal(txt(await p.readAt(s.oid, 'tez.docx')), 'ilk');
  // İndirilemeyen (prepareRead false) dosya: değişmiş görünse de eski hali kalır, kayıt alınmaz
  allow = false;
  w('Bölüm/not.txt', 'yine değişti');
  assert.equal(await p.snapshot(), null);
  allow = true;
  const s2 = await p.snapshot();
  assert.deepEqual(s2.changed, ['Bölüm/not.txt']);
});
