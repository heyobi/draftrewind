// Aşama 2a: git'i bilmeyen bir depo (Drive / iCloud klasörü) üzerinden cihazlar arası geçmiş eşitleme.
// Depo burada düz bir klasör: .draftrewind/packs/*.pack ve .draftrewind/heads/<cihaz>.json
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { openProject } from '../../src/git/engine.js';
import { backendNode } from '../support/backendNode.mjs';

const require = createRequire(import.meta.url);
const h = require('../../../tests/helpers.js');
after(() => h.cleanup());

// Klasör deposu; hide: henüz "görünmeyen" adlar (bulut gecikmesi benzetimi)
function dirStore(root, id = 'drive') {
  const hide = new Set();
  return {
    id,
    hide,
    async list() {
      const out = [];
      for (const sub of ['packs', 'heads']) {
        const d = path.join(root, sub);
        if (!fs.existsSync(d)) continue;
        for (const n of fs.readdirSync(d)) if (!hide.has(`${sub}/${n}`)) out.push(`${sub}/${n}`);
      }
      return out;
    },
    async read(name) {
      const p = path.join(root, ...name.split('/'));
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
    },
    async write(name, bytes) {
      const p = path.join(root, ...name.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, bytes);
    },
  };
}

async function device(label) {
  const root = h.tmpDir(`drw-st-${label}-`);
  return openProject({ backend: backendNode(), gitdir: path.join(root, 'git'), dir: path.join(root, 'Tezim'), id: 'ortak', name: 'Tezim', author: { name: label } });
}
const put = (p, rel, data) => h.write(path.join(p.dir, ...rel.split('/')), data);
const read = (p, rel) => fs.readFileSync(path.join(p.dir, ...rel.split('/')), 'utf8');
const exists = (p, rel) => fs.existsSync(path.join(p.dir, ...rel.split('/')));
const sync = (p, store, id) => p.syncStoreWithSnapshot({ store, deviceId: id, deviceName: id });
function listing(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else out[r] = fs.readFileSync(path.join(abs, e.name), 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

test('telefon → depo → bilgisayar: dosyalar ve geçmiş aynen; sonraki gönderim yalnızca yeni nesneler', async () => {
  const store = dirStore(h.tmpDir('drw-store-'));
  const tel = await device('tel');
  put(tel, 'tez.txt', 'giriş bölümü');
  put(tel, 'Bölüm 2/yöntem.md', '# Yöntem\nveri toplandı');
  const r1 = await sync(tel, store, 'tel');
  assert.equal(r1.pushed, true);
  assert.equal(r1.ahead, false);
  const packs1 = (await store.list()).filter((n) => n.startsWith('packs/'));
  assert.equal(packs1.length, 1);

  const pc = await device('pc');
  const r2 = await sync(pc, store, 'pc');
  assert.equal(r2.pulled, 2);
  assert.deepEqual(listing(pc.dir), listing(tel.dir));
  assert.equal(await pc.head(), await tel.head());
  assert.equal((await pc.history())[0].author, 'tel');

  // Telefon bir dosyayı değiştirir: yeni paket yalnızca yeni kayıt + değişen blob + yolundaki ağaç
  put(tel, 'tez.txt', 'giriş bölümü genişletildi');
  await sync(tel, store, 'tel');
  const packs2 = (await store.list()).filter((n) => n.startsWith('packs/'));
  assert.equal(packs2.length, 2);
  const newPack = packs2.find((n) => !packs1.includes(n));
  const objs = await pc.objectsSince(await tel.head(), [r1.head]).catch(() => null);
  assert.equal(objs, null); // pc henüz bu nesnelere sahip değil (paketi almadı)
  const telObjs = await tel.objectsSince(await tel.head(), [r1.head]);
  assert.equal(telObjs.length, 3); // kayıt + kök ağaç + tez.txt blob'u
  assert.ok(newPack);

  await sync(pc, store, 'pc');
  assert.equal(read(pc, 'tez.txt'), 'giriş bölümü genişletildi');
  assert.equal(await pc.head(), await tel.head());
  // Değişiklik yokken: yeni paket ya da yeniden yayım yok
  const again = await sync(pc, store, 'pc');
  assert.equal(again.pushed, false);
  assert.equal((await store.list()).filter((n) => n.startsWith('packs/')).length, 2);
});

test('iki cihaz eşitlemeden farklı dosyaları değiştirir → ikisi de birleşir; aynı dosya → iki hali de kalır', async () => {
  const store = dirStore(h.tmpDir('drw-store-'));
  const a = await device('a');
  put(a, 'tez.txt', 'ortak başlangıç');
  put(a, 'notlar.md', 'not');
  await sync(a, store, 'a');
  const b = await device('b');
  await sync(b, store, 'b');

  // Farklı dosyalar
  put(a, 'notlar.md', 'not A tarafından');
  put(b, 'kaynak.bib', '@book{x}');
  await sync(a, store, 'a');
  await sync(b, store, 'b'); // a'yı alır, birleştirir, yayımlar
  await sync(a, store, 'a'); // b'nin birleştirmesini alır
  assert.deepEqual(listing(a.dir), listing(b.dir));
  assert.equal(read(a, 'kaynak.bib'), '@book{x}');
  assert.equal(read(b, 'notlar.md'), 'not A tarafından');
  assert.equal(await a.head(), await b.head());

  // Aynı dosya iki tarafta
  put(a, 'tez.txt', 'A sürümü');
  put(b, 'tez.txt', 'B sürümü');
  await sync(a, store, 'a');
  const rb = await sync(b, store, 'b');
  assert.deepEqual(rb.conflicts, ['tez (diğer cihazdan).txt']);
  assert.equal(read(b, 'tez.txt'), 'B sürümü');
  assert.equal(read(b, 'tez (diğer cihazdan).txt'), 'A sürümü');
  await sync(a, store, 'a');
  assert.deepEqual(listing(a.dir), listing(b.dir));
  // Hiçbir sürüm kaybolmadı: iki hal de geçmişte
  const texts = [];
  for (const it of await a.history({ limit: 50 })) {
    const u8 = await a.readAt(it.oid, 'tez.txt');
    if (u8) texts.push(Buffer.from(u8).toString('utf8'));
  }
  assert.ok(texts.includes('A sürümü') && texts.includes('B sürümü'));
});

test('paketi henüz görünmeyen uç atlanır, bir sonraki turda alınır; yarım paket bozmaz', async () => {
  const root = h.tmpDir('drw-store-');
  const store = dirStore(root);
  const a = await device('a2');
  put(a, 'tez.txt', 'bir');
  await sync(a, store, 'a');
  const b = await device('b2');
  // b paketi göremiyor (yalnızca uç dosyası)
  for (const n of await store.list()) if (n.startsWith('packs/')) store.hide.add(n);
  const r1 = await sync(b, store, 'b');
  assert.equal(r1.pulled, 0);
  assert.equal(exists(b, 'tez.txt'), false);
  // Paket yarım yüklenmiş görünür
  const packName = [...store.hide][0];
  const full = fs.readFileSync(path.join(root, ...packName.split('/')));
  fs.writeFileSync(path.join(root, ...packName.split('/')), full.subarray(0, 20));
  store.hide.clear();
  const r2 = await sync(b, store, 'b');
  assert.equal(r2.pulled, 0);
  // Tamamlandı
  fs.writeFileSync(path.join(root, ...packName.split('/')), full);
  const r3 = await sync(b, store, 'b');
  assert.equal(r3.pulled, 1);
  assert.equal(read(b, 'tez.txt'), 'bir');
});

test('kayıt noktasına girmemiş yerel düzenleme uzaktan gelenle ezilmez', async () => {
  const store = dirStore(h.tmpDir('drw-store-'));
  const a = await device('a3');
  put(a, 'tez.txt', 'ilk');
  await sync(a, store, 'a');
  const b = await device('b3');
  await sync(b, store, 'b');
  put(a, 'tez.txt', 'A ikinci');
  await sync(a, store, 'a');
  // b düzenler ama kayıt almadan yalnızca eşitler
  put(b, 'tez.txt', 'B kaydedilmemiş');
  const r = await b.syncStore({ store, deviceId: 'b' });
  assert.equal(read(b, 'tez.txt'), 'B kaydedilmemiş');
  assert.equal(read(b, 'tez (diğer cihazdan).txt'), 'A ikinci');
  assert.deepEqual(r.conflicts, ['tez (diğer cihazdan).txt']);
});

test('MASAÜSTÜ ile TELEFON aynı klasör deposu üzerinden: geçmiş ve dosyalar aynı, çakışmada iki hal', async () => {
  const { syncStore } = require('../../../app/core/storeSync.js');
  const store = dirStore(h.tmpDir('drw-store-x-'));
  const pc = await h.openProject({ root: h.tmpDir('drw-st-pc-'), id: 'ortak', name: 'Tezim' });
  const pput = (rel, data) => h.write(path.join(pc.dir, ...rel.split('/')), data);
  pput('tez.txt', 'masaüstünde başladı');
  pput('Bölüm 1/giriş.md', '# Giriş');
  await pc.snapshot();
  const d1 = await syncStore(pc, { store, deviceId: 'pc', deviceName: 'PC' });
  assert.equal(d1.pushed, true);

  const tel = await device('x-tel');
  const t1 = await sync(tel, store, 'tel');
  assert.equal(t1.pulled, 2);
  assert.deepEqual(listing(tel.dir), listing(pc.dir));
  assert.equal(await tel.head(), await pc.head());

  // Telefon yazar → masaüstü ileri sarar ve telefonun kaydını kendi geçmişinde görür
  put(tel, 'tez.txt', 'telefonda devam etti');
  const t2 = await sync(tel, store, 'tel');
  const d2 = await syncStore(pc, { store, deviceId: 'pc' });
  assert.equal(d2.pulled, 1);
  assert.equal(fs.readFileSync(path.join(pc.dir, 'tez.txt'), 'utf8'), 'telefonda devam etti');
  assert.equal(await pc.head(), t2.head);
  assert.equal((await pc.history())[0].author, 'x-tel');

  // İkisi aynı dosyayı değiştirir
  pput('tez.txt', 'PC hali');
  await pc.snapshot();
  put(tel, 'tez.txt', 'TEL hali');
  await sync(tel, store, 'tel');
  const d3 = await syncStore(pc, { store, deviceId: 'pc' });
  assert.deepEqual(d3.conflicts, ['tez (diğer cihazdan).txt']);
  await sync(tel, store, 'tel');
  assert.deepEqual(listing(tel.dir), listing(pc.dir));
  assert.equal(fs.readFileSync(path.join(pc.dir, 'tez.txt'), 'utf8'), 'PC hali');
  assert.equal(read(tel, 'tez (diğer cihazdan).txt'), 'TEL hali');
});

test('uç dosyası proje bilgisini taşır (GitHub bağlantısı); yalnızca bilgi değişince de yeniden yazılır', async () => {
  const { syncStore } = require('../../../app/core/storeSync.js');
  const store = dirStore(h.tmpDir('drw-store-meta-'));
  const tel = await device('meta-tel');
  put(tel, 'a.txt', 'bir');
  await tel.syncStoreWithSnapshot({ store, deviceId: 'tel' });
  const pc = await h.openProject({ root: h.tmpDir('drw-st-pcm-'), id: 'ortak', name: 'Tezim' });
  const d1 = await syncStore(pc, { store, deviceId: 'pc' });
  assert.equal(d1.peers.find((x) => x.id === 'tel').github, null);
  // Telefon GitHub'a bağlandı: yeni kayıt olmadan uç dosyası güncellenir
  const r = await tel.syncStore({ store, deviceId: 'tel', meta: { github: { owner: 'ogrenci', repo: 'draftrewind-tezim' } } });
  assert.equal(r.pushed, true);
  const d2 = await syncStore(pc, { store, deviceId: 'pc' });
  assert.deepEqual(d2.peers.find((x) => x.id === 'tel').github, { owner: 'ogrenci', repo: 'draftrewind-tezim' });
  // Bilgi aynı kaldıkça yeniden yazılmaz
  const again = await tel.syncStore({ store, deviceId: 'tel', meta: { github: { owner: 'ogrenci', repo: 'draftrewind-tezim' } } });
  assert.equal(again.pushed, false);
});

test('proje kimliği (kök kayıtlar): telefon ve masaüstü aynı sonucu bulur, uç dosyasında taşınır', async () => {
  const { syncStore, rootsOf } = require('../../../app/core/storeSync.js');
  const store = dirStore(h.tmpDir('drw-store-root-'));
  const tel = await device('root-tel');
  put(tel, 'a.txt', 'bir');
  await tel.snapshot();
  put(tel, 'a.txt', 'iki');
  await tel.snapshot();
  const roots = await tel.roots();
  assert.equal(roots.length, 1);
  assert.deepEqual(await tel.roots(), roots); // önbellek
  await tel.syncStore({ store, deviceId: 'tel', meta: { roots } });
  const pc = await h.openProject({ root: h.tmpDir('drw-st-pcr-'), id: 'ortak', name: 'Tezim' });
  const d = await syncStore(pc, { store, deviceId: 'pc' });
  assert.deepEqual(d.peers.find((x) => x.id === 'tel').roots, roots);
  assert.deepEqual(await rootsOf(pc.gitdir, await pc.head()), roots);
});
