// Telefondaki Drive dosya eşitlemesi (src/git/mirror.js): masaüstündeki reconcile ile aynı kurallar
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { openProject } from '../../src/git/engine.js';
import { mirror } from '../../src/git/mirror.js';
import { backendNode } from '../support/backendNode.mjs';

const require = createRequire(import.meta.url);
const h = require('../../../tests/helpers.js');
after(() => h.cleanup());

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
// Bellekte Drive klasörü
function memRemote() {
  const files = new Map(); // rel → Buffer
  const versions = [];
  const archived = [];
  return {
    files,
    versions,
    archived,
    async list() {
      return new Map([...files].map(([rel, b]) => [rel, { md5: md5(b), size: b.length }]));
    },
    async read(rel) {
      return new Uint8Array(files.get(rel));
    },
    async write(rel, bytes) {
      files.set(rel, Buffer.from(bytes));
      return md5(Buffer.from(bytes));
    },
    async version(rel, bytes, kind) {
      versions.push({ rel, kind, text: Buffer.from(bytes).toString('utf8') });
    },
    async archive(rel) {
      archived.push(rel);
      files.delete(rel);
    },
  };
}

async function phone(label) {
  const root = h.tmpDir(`drw-mir-${label}-`);
  return openProject({ backend: backendNode(), gitdir: path.join(root, 'git'), dir: path.join(root, 'Tezim'), id: 'p', name: 'Tezim' });
}
const put = (p, rel, data) => h.write(path.join(p.dir, ...rel.split('/')), data);
const read = (p, rel) => fs.readFileSync(path.join(p.dir, ...rel.split('/')), 'utf8');
const exists = (p, rel) => fs.existsSync(path.join(p.dir, ...rel.split('/')));

test('ilk eşitleme: Drive dosyaları iner, telefondakiler yüklenir; aynı içerik tekrar aktarılmaz', async () => {
  const p = await phone('ilk');
  const remote = memRemote();
  remote.files.set('tez.txt', Buffer.from('Drive’da yazıldı'));
  remote.files.set('Bölüm 2/yöntem.md', Buffer.from('# Yöntem'));
  put(p, 'notlar.md', 'telefonda');
  const state = {};
  const r = await mirror(p, remote, state);
  assert.deepEqual(r.downloaded.sort(), ['Bölüm 2/yöntem.md', 'tez.txt']);
  assert.deepEqual(r.uploaded, ['notlar.md']);
  assert.equal(read(p, 'tez.txt'), 'Drive’da yazıldı');
  assert.equal(remote.files.get('notlar.md').toString(), 'telefonda');
  const again = await mirror(p, remote, state);
  assert.deepEqual([again.uploaded, again.downloaded, again.conflicts], [[], [], []]);
});

test('Google Dokümanlar düzenlemesi iner; telefon düzenlemesi yüklenir (+ _Sürümler kopyası); ikisi birden → iki hal', async () => {
  const p = await phone('duz');
  const remote = memRemote();
  put(p, 'tez.docx', 'v1');
  const state = {};
  await mirror(p, remote, state, { now: 1000 });
  // Drive'da (Google Dokümanlar) düzenlendi
  remote.files.set('tez.docx', Buffer.from('v2 Drive'));
  const r1 = await mirror(p, remote, state, { now: 2000 });
  assert.deepEqual(r1.downloaded, ['tez.docx']);
  assert.equal(read(p, 'tez.docx'), 'v2 Drive');
  // Telefonda düzenlendi
  put(p, 'tez.docx', 'v3 telefon');
  const r2 = await mirror(p, remote, state, { now: 3000 + 31 * 60 * 1000 });
  assert.deepEqual(r2.uploaded, ['tez.docx']);
  assert.equal(remote.files.get('tez.docx').toString(), 'v3 telefon');
  assert.equal(remote.versions.length, 1);
  // İkisi birden
  put(p, 'tez.docx', 'v4 telefon');
  remote.files.set('tez.docx', Buffer.from('v4 Drive'));
  const r3 = await mirror(p, remote, state, { now: 5000 });
  assert.deepEqual(r3.conflicts, ["tez (Drive'dan).docx"]);
  assert.equal(read(p, 'tez.docx'), 'v4 telefon');
  assert.equal(read(p, "tez (Drive'dan).docx"), 'v4 Drive');
  assert.equal(remote.files.get('tez.docx').toString(), 'v4 telefon');
  assert.equal(remote.files.get("tez (Drive'dan).docx").toString(), 'v4 Drive');
});

test('telefonda silinen dosya Drive’da _Sürümler’e taşınır; Drive’dan silinen yeniden yüklenir; yalnızca-indir modunda yükleme yok', async () => {
  const p = await phone('sil');
  const remote = memRemote();
  put(p, 'a.txt', 'a');
  put(p, 'b.txt', 'b');
  const state = {};
  await mirror(p, remote, state);
  fs.rmSync(path.join(p.dir, 'a.txt'));
  remote.files.delete('b.txt');
  const r = await mirror(p, remote, state);
  assert.deepEqual(r.archived, ['a.txt']);
  assert.deepEqual(r.uploaded, ['b.txt']);
  assert.equal(exists(p, 'a.txt'), false);
  put(p, 'c.txt', 'c');
  const ro = await mirror(p, remote, state, { upload: false });
  assert.deepEqual(ro.pending, ['c.txt']);
  assert.equal(remote.files.has('c.txt'), false);
});
