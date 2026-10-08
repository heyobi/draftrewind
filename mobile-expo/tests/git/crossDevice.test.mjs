// MASAÜSTÜ ↔ TELEFON: masaüstü motoru (app/core/engine.js + github.js) ile telefon motoru (src/git/engine.js)
// yerel bir git http-backend sunucusu üzerinden eşitlenir. Hiçbir sürüm kaybolmamalı.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as git from 'isomorphic-git';
import { openProject, parseMessage } from '../../src/git/engine.js';
import { createFs } from '../../src/git/fsAdapter.js';
import { http, makeHttp } from '../../src/git/http.js';
import { backendNode } from '../support/backendNode.mjs';

const require = createRequire(import.meta.url);
const h = require('../../../tests/helpers.js');
const github = require('../../../app/core/github.js');

let srv;
let srvRoot;
let n = 0;
before(async () => {
  srvRoot = h.tmpDir('drw-xdev-');
  srv = await h.startGitServer(srvRoot);
});
after(async () => {
  if (srv) await new Promise((r) => srv.server.close(r));
  h.cleanup();
});

// Her test kendi boş uzak deposunu alır
function newRemote() {
  const name = `depo-${++n}`;
  h.initBareRepo(path.join(srvRoot, 'ogrenci', `${name}.git`));
  return `http://127.0.0.1:${srv.port}/ogrenci/${name}.git`;
}

async function desktop(label) {
  const p = await h.openProject({ root: h.tmpDir(`drw-pc-${label}-`), id: 'ortak', name: 'Tezim' });
  p.meta = { github: { owner: 'ogrenci', repo: 'x' } };
  return p;
}

async function phone(label) {
  const root = h.tmpDir(`drw-tel-${label}-`);
  return openProject({ backend: backendNode(), gitdir: path.join(root, 'Library', 'git', 'ortak'), dir: path.join(root, 'Documents', 'Projeler', 'Tezim'), id: 'ortak', name: 'Tezim', author: { name: 'Telefon' } });
}

const file = (p, rel) => path.join(p.dir, ...rel.split('/'));
const put = (p, rel, data) => h.write(file(p, rel), data);
const read = (p, rel) => fs.readFileSync(file(p, rel), 'utf8');
const exists = (p, rel) => fs.existsSync(file(p, rel));
const COPY = (base, ext) => `${base} (diğer cihazdan)${ext}`;

// Klasördeki tüm dosyalar (yok sayılanlar hariç) → { rel: md5 }
function listing(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else out[r] = h.md5(fs.readFileSync(path.join(abs, e.name)));
    }
  };
  walk(dir, '');
  return out;
}

const tsync = (ph, url) => ph.sync({ remoteUrl: url, token: 'belirtec', http });
const dsync = (pc, url) => github.sync(pc, 'belirtec', { url });

test('masaüstü → telefon → masaüstü; aynı dosyada ayrışma; geçmişler aynı HEAD’de buluşur', async () => {
  const url = newRemote();
  const pc = await desktop('a');
  const ph = await phone('a');

  // 1) Masaüstü ilk kez gönderir
  put(pc, 'tez.txt', 'giriş bölümü');
  put(pc, 'Bölüm 2/yöntem.docx', await h.makeDocx(['Yöntem bölümü burada', 'İkinci paragraf']));
  put(pc, 'kaynak.bib', '@article{a,\n}\n');
  await pc.snapshot();
  await dsync(pc, url);

  // 2) Telefon bağlanır → birebir aynı dosyalar, aynı HEAD
  const r1 = await tsync(ph, url);
  assert.equal(r1.pulled, 3);
  assert.equal(r1.pushed, false);
  assert.deepEqual(listing(ph.dir), listing(pc.dir));
  assert.equal(await ph.head(), await pc.head());
  // Telefon masaüstünün kelime sayılarını görür
  const ph0 = (await ph.history())[0];
  assert.ok(ph0.words['Bölüm 2/yöntem.docx'] > 0);
  // Değişiklik yok: telefon kayıt almaz (karma önbelleği ilk taramada dolar)
  assert.equal(await ph.snapshot(), null);

  // 3) Telefon düzenler, gönderir → masaüstü ileri sarar
  put(ph, 'tez.txt', 'giriş bölümü telefondan eklendi');
  put(ph, 'Fotoğraflar/tahta.jpg', Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
  const s = await ph.snapshot();
  assert.deepEqual([...s.changed].sort(), ['Fotoğraflar/tahta.jpg', 'tez.txt']);
  const r2 = await tsync(ph, url);
  assert.equal(r2.pushed, true);
  const d2 = await dsync(pc, url);
  assert.equal(d2.pulled, 2);
  assert.deepEqual(d2.conflicts, []);
  assert.equal(read(pc, 'tez.txt'), 'giriş bölümü telefondan eklendi');
  assert.deepEqual(listing(pc.dir), listing(ph.dir));
  // Masaüstü telefonun kaydını kendi kaydı gibi okur (kuyruk alanları)
  const dh = (await pc.history())[0];
  assert.equal(dh.oid, s.oid);
  assert.equal(dh.author, 'Telefon');
  assert.equal(dh.kind, 'auto');
  assert.deepEqual([...dh.changed].sort(), ['Fotoğraflar/tahta.jpg', 'tez.txt']);
  assert.equal(dh.delta['tez.txt'], 2);
  assert.equal(dh.words['tez.txt'], 4);
  assert.equal(dh.total, Object.values(dh.words).reduce((a, b) => a + b, 0));
  // Masaüstü sonraki kaydında telefonun kelime haritasını sürdürür
  put(pc, 'kaynak.bib', '@article{a,\n}\n@book{b,\n}\n');
  const dsnap = await pc.snapshot();
  assert.ok(dsnap);
  assert.equal((await pc.history())[0].words['tez.txt'], 4);
  await dsync(pc, url);
  await tsync(ph, url);
  assert.equal(read(ph, 'kaynak.bib'), '@article{a,\n}\n@book{b,\n}\n');

  // 4) İki cihaz aynı dosyayı eşitlemeden değiştirir; masaüstü önce gönderir, telefon ikinci çeker
  put(pc, 'tez.txt', 'MASAÜSTÜ sürümü');
  put(pc, 'masaustu-yeni.txt', 'sadece masaüstü');
  await pc.snapshot();
  put(ph, 'tez.txt', 'TELEFON sürümü, daha uzun');
  put(ph, 'telefon-yeni.txt', 'sadece telefon');
  await ph.snapshot();
  await dsync(pc, url);
  const r4 = await tsync(ph, url);
  const copy = COPY('tez', '.txt');
  assert.deepEqual(r4.conflicts, [copy]);
  assert.equal(r4.pushed, true);
  assert.equal(read(ph, 'tez.txt'), 'TELEFON sürümü, daha uzun');
  assert.equal(read(ph, copy), 'MASAÜSTÜ sürümü');
  assert.equal(read(ph, 'masaustu-yeni.txt'), 'sadece masaüstü');
  const { commit } = await git.readCommit({ fs, gitdir: ph.gitdir, oid: r4.head });
  assert.equal(commit.parent.length, 2);
  assert.equal(parseMessage(commit.message).meta.kind, 'merge');
  assert.equal(parseMessage(commit.message).title, 'Diğer cihazla birleştirildi (1 dosyanın iki hali de saklandı)');

  // Masaüstü birleştirmeyi alır: iki sürüm de iki cihazda, HEAD aynı
  await dsync(pc, url);
  assert.equal(await pc.head(), await ph.head());
  assert.equal(read(pc, 'tez.txt'), 'TELEFON sürümü, daha uzun');
  assert.equal(read(pc, copy), 'MASAÜSTÜ sürümü');
  assert.equal(read(pc, 'telefon-yeni.txt'), 'sadece telefon');
  assert.deepEqual(listing(pc.dir), listing(ph.dir));

  // 5) Tersi: telefon önce gönderir, masaüstü ikinci çeker → kopya masaüstünde
  put(ph, 'kaynak.bib', 'TELEFON bib');
  await ph.snapshot();
  await tsync(ph, url);
  put(pc, 'kaynak.bib', 'MASAÜSTÜ bib');
  await pc.snapshot();
  const d5 = await dsync(pc, url);
  assert.deepEqual(d5.conflicts, [COPY('kaynak', '.bib')]);
  assert.equal(read(pc, 'kaynak.bib'), 'MASAÜSTÜ bib');
  assert.equal(read(pc, COPY('kaynak', '.bib')), 'TELEFON bib');
  const r5 = await tsync(ph, url);
  assert.equal(r5.pushed, false);
  assert.equal(await ph.head(), await pc.head());
  assert.equal(read(ph, 'kaynak.bib'), 'MASAÜSTÜ bib');
  assert.equal(read(ph, COPY('kaynak', '.bib')), 'TELEFON bib');
  assert.deepEqual(listing(pc.dir), listing(ph.dir));

  // 6) Değişiklik yokken: gönderim/çekim yok
  const r6 = await tsync(ph, url);
  assert.equal(r6.pushed, false);
  assert.equal(r6.pulled, 0);
  // Uzak depo da aynı HEAD'de
  const remoteHead = (await git.listServerRefs({ http, url })).find((r) => r.ref === 'refs/heads/main').oid;
  assert.equal(remoteHead, await ph.head());
});

test('telefonda kayıt noktasına girmemiş düzenleme: uzaktan gelen sürüm ezmez/silmez, kopya olarak gelir', async () => {
  const url = newRemote();
  const pc = await desktop('b');
  const ph = await phone('b');
  put(pc, 'tez.txt', 'ilk hal');
  put(pc, 'notlar.txt', 'silinecek');
  await pc.snapshot();
  await dsync(pc, url);
  await tsync(ph, url);

  // Masaüstü tez.txt'yi değiştirir, notlar.txt'yi siler, gönderir
  put(pc, 'tez.txt', 'masaüstü sürümü');
  fs.unlinkSync(file(pc, 'notlar.txt'));
  await pc.snapshot();
  await dsync(pc, url);

  // Telefon aynı dosyaları kaydeder ama kayıt noktası alınmadan eşitleme gelir (ileri sarma yolu)
  put(ph, 'tez.txt', 'telefon kaydetti, kayıt noktası yok');
  put(ph, 'notlar.txt', 'telefon notlara yazdı');
  const r = await tsync(ph, url);
  assert.ok(r.pulled >= 1);
  assert.equal(read(ph, 'tez.txt'), 'telefon kaydetti, kayıt noktası yok');
  assert.equal(read(ph, COPY('tez', '.txt')), 'masaüstü sürümü');
  assert.equal(read(ph, 'notlar.txt'), 'telefon notlara yazdı');

  // Telefon kayıt alıp gönderir → masaüstü üç dosyanın hepsini alır; hiçbir şey kaybolmadı
  const s = await ph.snapshot();
  assert.deepEqual([...s.changed].sort(), ['notlar.txt', COPY('tez', '.txt'), 'tez.txt']);
  await tsync(ph, url);
  await dsync(pc, url);
  assert.equal(read(pc, 'tez.txt'), 'telefon kaydetti, kayıt noktası yok');
  assert.equal(read(pc, COPY('tez', '.txt')), 'masaüstü sürümü');
  assert.equal(read(pc, 'notlar.txt'), 'telefon notlara yazdı');
  assert.equal(await pc.head(), await ph.head());

  // Ayrışma yolunda da: telefonda kayıt alınmış bir değişiklik + kayıt dışı düzenleme, masaüstünde başka değişiklik
  put(ph, 'a.txt', 'telefonda kayıtlı');
  await ph.snapshot();
  put(pc, 'tez.txt', 'masaüstü yeniden');
  await pc.snapshot();
  await dsync(pc, url);
  put(ph, 'tez.txt', 'telefonda kaydedildi, kayıt noktası yok (2)');
  const r2 = await tsync(ph, url);
  assert.deepEqual(r2.conflicts, [COPY('tez', '.txt')]);
  assert.equal(read(ph, 'tez.txt'), 'telefonda kaydedildi, kayıt noktası yok (2)');
  assert.equal(read(ph, COPY('tez', '.txt')), 'masaüstü yeniden');
  await ph.snapshot();
  await tsync(ph, url);
  await dsync(pc, url);
  assert.equal(read(pc, 'tez.txt'), 'telefonda kaydedildi, kayıt noktası yok (2)');
  assert.equal(read(pc, 'a.txt'), 'telefonda kayıtlı');
  assert.equal(await pc.head(), await ph.head());
});

test('syncWithSnapshot: kayıt + eşitleme tek adımda; boş uzak depoya ilk gönderim', async () => {
  const url = newRemote();
  const ph = await phone('c');
  put(ph, 'tez.txt', 'telefonda başladım');
  const r = await ph.syncWithSnapshot({ remoteUrl: url, token: 't', http, snapshot: { kind: 'auto' } });
  assert.ok(r.snapshot && r.snapshot.oid);
  assert.equal(r.pushed, true);
  assert.equal(r.head, r.snapshot.oid);
  const pc = await desktop('c');
  await dsync(pc, url);
  assert.equal(read(pc, 'tez.txt'), 'telefonda başladım');
});

test('importLocalLog → GitHub → masaüstü geçmişi kayıtları sırayla ve kuyruk alanlarıyla listeler', async () => {
  const url = newRemote();
  const ph = await phone('d');
  const t1 = Date.UTC(2026, 7, 1, 8, 0, 0);
  const t2 = Date.UTC(2026, 7, 3, 12, 0, 0);
  const t3 = Date.UTC(2026, 7, 9, 18, 30, 0);
  const copies = {
    'r1/tez.txt': 'bir',
    'r2/tez.txt': 'bir iki üç',
    'r2/ek.md': 'ek dosya',
    'r3/tez.txt': 'bir iki üç dört',
  };
  const records = [
    { id: 'r1', time: t1, kind: 'auto', title: 'Yeni dosya: tez.txt', changed: ['tez.txt'], added: ['tez.txt'], deleted: [], delta: { 'tez.txt': 1 }, words: { 'tez.txt': 1 }, total: 1, files: { 'tez.txt': 'r1/tez.txt' } },
    { id: 'r2', time: t2, kind: 'auto', title: 'tez: 2 kelime eklendi', changed: ['tez.txt', 'ek.md'], added: ['ek.md'], deleted: [], delta: { 'tez.txt': 2, 'ek.md': 2 }, words: { 'tez.txt': 3, 'ek.md': 2 }, total: 5, files: { 'tez.txt': 'r2/tez.txt', 'ek.md': 'r2/ek.md' } },
    { id: 'r3', time: t3, kind: 'star', title: 'Danışmana gönderilen', changed: ['tez.txt'], added: [], deleted: ['ek.md'], delta: { 'tez.txt': 1, 'ek.md': -2 }, words: { 'tez.txt': 4 }, total: 4, files: { 'tez.txt': 'r3/tez.txt' } },
  ].reverse();
  const res = await ph.importLocalLog({ records, readCopy: async (rec, rel) => new TextEncoder().encode(copies[rec.files[rel]]) });
  assert.equal(res.commits.length, 3);
  // Çalışma klasörü son hal (taşıma sırasında dosyalar zaten orada)
  put(ph, 'tez.txt', 'bir iki üç dört');
  assert.equal(await ph.snapshot(), null);
  await tsync(ph, url);

  const pc = await desktop('d');
  await dsync(pc, url);
  const hist = await pc.history();
  assert.deepEqual(hist.map((x) => x.time), [t3, t2, t1]);
  assert.deepEqual(hist.map((x) => x.title), ['Danışmana gönderilen', 'tez: 2 kelime eklendi', 'Yeni dosya: tez.txt']);
  assert.deepEqual(hist.map((x) => x.kind), ['star', 'auto', 'auto']);
  assert.deepEqual(hist.map((x) => x.total), [4, 5, 1]);
  assert.deepEqual(hist[1].changed, ['tez.txt', 'ek.md']);
  assert.deepEqual(hist[0].deleted, ['ek.md']);
  assert.deepEqual(hist[1].words, { 'tez.txt': 3, 'ek.md': 2 });
  assert.equal((await pc.readAt(hist[1].oid, 'ek.md')).toString('utf8'), 'ek dosya');
  assert.equal(read(pc, 'tez.txt'), 'bir iki üç dört');
  assert.equal(exists(pc, 'ek.md'), false);
});

test('http istemcisi: Node fetch ile clone / fetch / push (isomorphic-git, fsAdapter üzerinden)', async () => {
  const url = newRemote();
  const pc = await desktop('e');
  put(pc, 'tez.txt', 'sunucudaki ilk hal');
  await pc.snapshot();
  await dsync(pc, url);

  // clone (çalışma klasörüyle) — telefonun fs katmanıyla
  const root = h.tmpDir('drw-http-');
  const fsx = createFs(backendNode());
  const dir = path.join(root, 'w').replace(/\\/g, '/');
  let fetched = 0;
  const counting = makeHttp((u, init) => {
    fetched++;
    // İstek gövdesi tek parça Uint8Array olarak gider (akış yok)
    if (init.body) assert.ok(init.body instanceof Uint8Array);
    return fetch(u, init);
  });
  await git.clone({ fs: fsx, http: counting, dir, url, ref: 'main', singleBranch: true });
  assert.ok(fetched >= 2);
  assert.equal(fs.readFileSync(path.join(dir, 'tez.txt'), 'utf8'), 'sunucudaki ilk hal');

  // Yerel kayıt + push
  fs.writeFileSync(path.join(dir, 'yeni.txt'), 'clone tarafından');
  await git.add({ fs: fsx, dir, filepath: 'yeni.txt' });
  const a = { name: 'T', email: 't@t' };
  const c = await git.commit({ fs: fsx, dir, message: 'clone kaydı\n', author: a });
  const pr = await git.push({ fs: fsx, http: counting, dir, remote: 'origin', ref: 'main' });
  assert.equal(pr.ok, true);

  // Masaüstü değişikliği alır, yeni kayıt gönderir; clone fetch ile görür
  await dsync(pc, url);
  assert.equal(await pc.head(), c);
  put(pc, 'tez.txt', 'masaüstü güncelledi');
  await pc.snapshot();
  await dsync(pc, url);
  const fr = await git.fetch({ fs: fsx, http: counting, dir, remote: 'origin', ref: 'main', singleBranch: true });
  assert.equal(fr.fetchHead, await pc.head());

  // Yetkisiz yanıt EGHAUTH'a çevrilir
  const ph = await phone('e');
  const denied = makeHttp(async (u) => new Response('no', { status: 401, statusText: 'Unauthorized', headers: { 'content-type': 'text/plain' } }));
  await assert.rejects(ph.sync({ remoteUrl: url, token: 'yanlis', http: denied }), (e) => e.code === 'EGHAUTH');
});

test('eski çalışma alanından geçiş (baseFiles): düzenlenmemiş eski kopya güncellenir, düzenlenen korunur, kopya çoğalmaz', async () => {
  const url = await newRemote();
  const pc = await desktop('gecis');
  put(pc, 'tez.txt', 'birinci hali');
  put(pc, 'notlar.md', 'not birinci');
  put(pc, 'silinecek.txt', 'eski');
  put(pc, 'aynı.txt', 'değişmedi');
  await pc.snapshot();
  await dsync(pc, url);
  const base = await pc.head();
  const oidOf = async (rel) => (await git.readBlob({ fs, gitdir: pc.gitdir, oid: base, filepath: rel })).oid;
  const baseFiles = { 'tez.txt': await oidOf('tez.txt'), 'notlar.md': await oidOf('notlar.md'), 'silinecek.txt': await oidOf('silinecek.txt'), 'aynı.txt': await oidOf('aynı.txt') };

  // Eski telefon çalışma alanı: dosyalar bu kayıttan indirilmişti; notlar.md telefonda düzenlendi
  const ph = await phone('gecis');
  put(ph, 'tez.txt', 'birinci hali');
  put(ph, 'notlar.md', 'not telefonda düzenlendi');
  put(ph, 'silinecek.txt', 'eski');
  put(ph, 'aynı.txt', 'değişmedi');
  put(ph, 'yeni-telefon.txt', 'yalnızca telefonda');

  // Bu arada masaüstü ilerler
  put(pc, 'tez.txt', 'ikinci hali');
  fs.rmSync(file(pc, 'silinecek.txt'));
  await pc.snapshot();
  await dsync(pc, url);

  // İlk eşitleme: yalnızca al
  const r = await ph.sync({ remoteUrl: url, token: 'x', http, noPush: true, baseFiles });
  assert.equal(r.pushed, false);
  assert.equal(r.ahead, false);
  assert.equal(read(ph, 'tez.txt'), 'ikinci hali'); // eski kopya güncellendi
  assert.equal(exists(ph, 'silinecek.txt'), false); // masaüstünde silinen, düzenlenmemiş kopya gitti
  assert.equal(read(ph, 'notlar.md'), 'not telefonda düzenlendi'); // düzenleme korundu
  assert.equal(exists(ph, COPY('notlar', '.md')), false); // uzak değişmediği için kopya yok
  assert.equal(exists(ph, COPY('tez', '.txt')), false);
  assert.equal(exists(ph, COPY('aynı', '.txt')), false);

  // Sonra kayıt + gönderim: masaüstü telefonun düzenlemesini ve yeni dosyasını alır
  const r2 = await ph.syncWithSnapshot({ remoteUrl: url, token: 'x', http });
  assert.ok(r2.snapshot);
  assert.deepEqual([...r2.snapshot.changed].sort(), ['notlar.md', 'yeni-telefon.txt']);
  assert.equal(r2.pushed, true);
  await dsync(pc, url);
  assert.equal(read(pc, 'notlar.md'), 'not telefonda düzenlendi');
  assert.deepEqual(listing(pc.dir), listing(ph.dir));
});

test('noPush: kayıtlar bekler (ahead), sonraki eşitlemede gönderilir', async () => {
  const url = await newRemote();
  const ph = await phone('nopush');
  put(ph, 'a.txt', 'bir');
  const r = await ph.syncWithSnapshot({ remoteUrl: url, token: 'x', http, noPush: true });
  assert.equal(r.pushed, false);
  assert.equal(r.ahead, true);
  assert.equal(await ph.remoteHead(), null);
  const r2 = await ph.sync({ remoteUrl: url, token: 'x', http });
  assert.equal(r2.pushed, true);
  assert.equal(r2.ahead, false);
  assert.equal(await ph.remoteHead(), await ph.head());
  const cf = await ph.commitFiles(await ph.head());
  assert.deepEqual(cf, { parent: null, files: [{ path: 'a.txt', status: 'added' }] });
});
