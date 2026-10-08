// Hesapsız / iCloud projelerinin saf parçaları (src/localCore.js): node --test mobile-expo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_SNAPSHOT_GAP_MS,
  buildRecord,
  canCoalesce,
  mergeRecord,
  selectKeep,
  latestCopyIds,
  previousCopy,
  versionName,
  versionDirParts,
  stamp,
  desktopSafeName,
  snapshotTitle,
  isSignedIn,
  verifyCopy,
  extname,
  stem,
} from '../src/localCore.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- birleştirme (3 dk)
test('birleştirme: son otomatik kayıt 3 dakikadan yeniyse birleştirilir, değilse yeni kayıt', () => {
  const now = Date.UTC(2026, 9, 8, 12);
  const last = { id: 'a', time: now - 60 * 1000, kind: 'auto', changed: ['tez.docx'], deleted: [], files: {} };
  assert.equal(canCoalesce(last, now), true);
  assert.equal(canCoalesce({ ...last, time: now - MIN_SNAPSHOT_GAP_MS }, now), false);
  assert.equal(canCoalesce({ ...last, time: now - MIN_SNAPSHOT_GAP_MS + 1 }, now), true);
  assert.equal(canCoalesce({ ...last, kind: 'star' }, now), false);
  assert.equal(canCoalesce({ ...last, kind: 'restore' }, now), false);
  assert.equal(canCoalesce({ ...last, noCoalesce: true }, now), false);
  assert.equal(canCoalesce(null, now), false);
  // Saat geri alınmışsa (gelecekte görünen kayıt) birleştirme yapılmaz
  assert.equal(canCoalesce({ ...last, time: now + 5000 }, now), false);
});

test('birleştirme: aynı dosyanın kopyası değiştirilir, kelime farkları toplanır, eski kopya silinmek üzere döner', () => {
  const t0 = 1_000_000;
  const first = buildRecord({ id: 'r1', time: t0, changed: ['tez.docx'], added: [], counts: { 'tez.docx': 110 }, prevWords: { 'tez.docx': 100, 'not.txt': 5 }, files: { 'tez.docx': 'tez.docx/1000000.docx' } });
  assert.deepEqual(first.delta, { 'tez.docx': 10 });
  assert.equal(first.total, 115);
  const second = buildRecord({ id: 'r2', time: t0 + 60000, changed: ['tez.docx', 'yeni.md'], added: ['yeni.md'], counts: { 'tez.docx': 130, 'yeni.md': 3 }, prevWords: first.words, files: { 'tez.docx': 'tez.docx/1060000.docx', 'yeni.md': 'yeni.md/1060000.md' } });
  const { record, dropped } = mergeRecord(first, second);
  assert.equal(record.id, 'r1'); // yeni kayıt açılmadı
  assert.equal(record.time, t0 + 60000);
  assert.deepEqual(record.changed.sort(), ['tez.docx', 'yeni.md']);
  assert.deepEqual(record.added, ['yeni.md']);
  assert.deepEqual(record.delta, { 'tez.docx': 30, 'yeni.md': 3 });
  assert.equal(record.total, 138);
  assert.deepEqual(record.files, { 'tez.docx': 'tez.docx/1060000.docx', 'yeni.md': 'yeni.md/1060000.md' });
  assert.deepEqual(dropped, ['tez.docx/1000000.docx']);
});

test('birleştirme: aynı ad (aynı dakika) kopyası silinecekler listesine girmez; silinip geri gelen dosya değişmiş sayılır', () => {
  const a = { id: 'a', time: 1, kind: 'auto', changed: [], added: [], deleted: ['x.txt'], delta: { 'x.txt': -4 }, files: { 'y.txt': 'v/y.txt' } };
  const b = { id: 'b', time: 2, kind: 'auto', changed: ['x.txt', 'y.txt'], added: ['x.txt'], deleted: [], delta: { 'x.txt': 4 }, words: { 'x.txt': 4 }, total: 4, files: { 'x.txt': 'v/x.txt', 'y.txt': 'v/y.txt' } };
  const { record, dropped } = mergeRecord(a, b);
  assert.deepEqual(record.deleted, []);
  assert.deepEqual(record.changed, ['x.txt', 'y.txt']);
  assert.deepEqual(record.delta, {}); // -4 + 4 = 0 → net değişiklik yok
  assert.deepEqual(dropped, []);
});

// ---------------------------------------------------------------- seyreltme (masaüstüyle aynı durumlar)
test('selectKeep: 7 gün tümü, 60 gün günde bir, sonra haftada bir (tests/retention.test.js ile aynı)', () => {
  const DAY = 86400000;
  const now = Date.UTC(2026, 8, 24, 12);
  const list = [];
  for (let d = 0; d < 100; d++) for (let k = 0; k < 4; k++) list.push({ id: `${d}-${k}`, time: now - d * DAY - k * 3600000, kind: 'auto' });
  const keep = selectKeep(list, { now });
  const kept = list.filter((c) => keep.has(c.id));
  const byAge = (d) => kept.filter((c) => Number(c.id.split('-')[0]) === d).length;
  assert.equal(byAge(0), 4);
  assert.equal(byAge(6), 4);
  assert.equal(byAge(10), 1);
  assert.equal(byAge(59), 1);
  const old = kept.filter((c) => Number(c.id.split('-')[0]) >= 60).length;
  assert.ok(old >= 5 && old <= 7, `haftalık: ${old}`);
});

test('selectKeep: aynı gün eski otomatikler gider, en yeni ve yıldızlı kalır (keepAllMs: 0)', () => {
  const now = Date.UTC(2026, 8, 24, 20);
  const list = [];
  list.push({ id: 'son', time: now - 1000, kind: 'auto' });
  list.push({ id: 'yildiz', time: now - 2000, kind: 'star' });
  for (let i = 1; i <= 8; i++) list.push({ id: `a${i}`, time: now - 2000 - i * 60000, kind: 'auto' });
  const keep = selectKeep(list, { now, keepAllMs: 0 });
  assert.deepEqual([...keep].sort(), ['son', 'yildiz']);
  // Tekrar çalıştırınca bir şey değişmez
  const again = selectKeep(list.filter((c) => keep.has(c.id)), { now, keepAllMs: 0 });
  assert.equal(again.size, 2);
});

test('selectKeep + latestCopyIds: bir dosyanın son kopyası (dosya sonra silinse bile) asla seyreltilmez', () => {
  const now = Date.UTC(2026, 8, 24, 20);
  const log = [
    { id: 'n', time: now - 1000, kind: 'auto', files: { 'a.txt': 'x' } },
    { id: 'm', time: now - 2000, kind: 'auto', files: { 'b.txt': 'y' } }, // b'nin tek kopyası
    { id: 'o', time: now - 3000, kind: 'auto', files: { 'a.txt': 'z' } },
  ];
  const protect = latestCopyIds(log);
  assert.deepEqual([...protect].sort(), ['m', 'n']);
  const keep = selectKeep(log, { now, keepAllMs: 0, protect });
  assert.equal(keep.has('m'), true);
  assert.equal(keep.has('o'), false);
  assert.equal(previousCopy(log, 0, 'a.txt').id, 'o');
  assert.equal(previousCopy(log, 0, 'c.txt'), null);
});

// ---------------------------------------------------------------- _Sürümler adı = masaüstü
// app/core/drive.js'teki safeName / stamp / versionName kaynak koddan alınıp çalıştırılır
function desktopFns() {
  const src = fs.readFileSync(path.join(here, '..', '..', 'app', 'core', 'drive.js'), 'utf8');
  const grab = (name) => {
    const m = src.match(new RegExp(`function ${name}\\([^\\n]*?\\) \\{[\\s\\S]*?\\r?\\n\\}`));
    assert.ok(m, `drive.js içinde ${name} bulunamadı`);
    return m[0];
  };
  const extnameNode = (p) => {
    const b = p.split('/').pop();
    const i = b.lastIndexOf('.');
    return i <= 0 ? '' : b.slice(i);
  };
  const nodePath = { extname: extnameNode, basename: (p, e) => { const b = p.split('/').pop(); return e && b.endsWith(e) ? b.slice(0, b.length - e.length) : b; } };
  const T = (key) => (key === 'drive.starTag' ? 'yıldızlı' : key);
  // eslint-disable-next-line no-new-func
  return new Function('path', 'T', `${grab('safeName')}\n${grab('stamp')}\n${grab('versionName')}\nreturn { safeName, stamp, versionName };`)(nodePath, T);
}

test('_Sürümler adı: masaüstündeki drive.js versionName ile birebir aynı', () => {
  const D = desktopFns();
  const fixed = new Date(2026, 9, 8, 9, 5);
  assert.equal(stamp(fixed), D.stamp(fixed));
  assert.equal(stamp(fixed), '2026-10-08 09.05');
  for (const s of ['a<b>c:d"e/f\\g|h?i*j', '  Tez  ', 'Bölüm 1']) assert.equal(desktopSafeName(s), D.safeName(s));
  const cases = [
    ['Tez.docx', 'auto', ''],
    ['Bölümler/Giriş.docx', 'auto', ''],
    ['Tez.docx', 'star', ''],
    ['Notlar/Plan.tar.gz', 'auto', ' (silindi)'],
    ['.gizli', 'auto', ''],
    ['README', 'auto', ''],
    ['Soru?: "neden".txt', 'star', ''],
  ];
  for (const [rel, kind, suffix] of cases) {
    // Masaüstü anı Date.now()'dan alır: dakika sınırına denk gelirse bir kez daha dene
    let mine;
    let theirs;
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      mine = versionName(rel, kind, { date: d, suffix, starTag: 'yıldızlı' });
      theirs = D.versionName(rel, kind, suffix);
      if (mine === theirs || stamp(d) === stamp(new Date())) break;
    }
    assert.equal(mine, theirs, rel);
  }
  assert.deepEqual(versionDirParts('Bölümler/Alt/Giriş.docx'), ['_Sürümler', 'Bölümler', 'Alt']);
  assert.deepEqual(versionDirParts('Tez.docx'), ['_Sürümler']);
  assert.equal(extname('a/b.c/d'), '');
  assert.equal(stem('a/Tez.final.docx'), 'Tez.final');
});

// ---------------------------------------------------------------- başlık
test('başlık: "<dosya>: N kelime eklendi" kuralı', () => {
  const T = (key, v = {}) => ({
    'local.t.added': `Yeni dosya: ${v.name}`,
    'local.t.wordsAdded': `${v.name}: ${v.n} kelime eklendi`,
    'local.t.wordsRemoved': `${v.name}: ${v.n} kelime silindi`,
    'local.t.updated': `${v.name} güncellendi`,
    'local.t.deleted': `${v.name} silindi`,
    'local.t.many': `${v.name} ve ${v.n} dosya daha güncellendi`,
    'local.t.deletedCount': `${v.n} dosya silindi`,
    'local.t.words': ` (${v.n} kelime)`,
    'local.t.default': 'Kayıt noktası',
  })[key];
  assert.equal(snapshotTitle({ changed: ['Bölüm/Tez.docx'], delta: { 'Bölüm/Tez.docx': 42 } }, T), 'Tez: 42 kelime eklendi');
  assert.equal(snapshotTitle({ changed: ['Tez.docx'], delta: { 'Tez.docx': -7 } }, T), 'Tez: 7 kelime silindi');
  assert.equal(snapshotTitle({ changed: ['foto.jpg'], added: ['foto.jpg'] }, T), 'Yeni dosya: foto.jpg');
  assert.equal(snapshotTitle({ changed: ['tablo.xlsx'] }, T), 'tablo güncellendi');
  assert.equal(snapshotTitle({ deleted: ['eski.docx'] }, T), 'eski.docx silindi');
  assert.equal(snapshotTitle({ changed: ['a.docx', 'b.docx'], deleted: ['c.txt'], delta: { 'a.docx': 5, 'b.docx': 5 } }, T), 'a ve 1 dosya daha güncellendi, 1 dosya silindi (+10 kelime)');
  assert.equal(snapshotTitle({}, T), 'Kayıt noktası');
});

// ---------------------------------------------------------------- giriş kararı
test('giriş: GitHub/Google ya da hesapsız/iCloud tercihi uygulamayı açar', () => {
  assert.equal(isSignedIn({}), false);
  assert.equal(isSignedIn({ prefs: { localOnly: false, icloud: false } }), false);
  assert.equal(isSignedIn({ ghToken: 'x', prefs: {} }), true);
  assert.equal(isSignedIn({ google: { refresh_token: 'r' }, prefs: {} }), true);
  assert.equal(isSignedIn({ prefs: { localOnly: true } }), true);
  assert.equal(isSignedIn({ prefs: { icloud: true } }), true);
  // Her hesaptan çıkınca: hesapsız seçilmediyse giriş ekranı
  assert.equal(isSignedIn({ ghToken: null, google: null, prefs: { localOnly: false } }), false);
  assert.equal(isSignedIn({ ghToken: null, google: null, prefs: { localOnly: true } }), true);
  // Bozuk tercih değerleri açık sayılmaz
  assert.equal(isSignedIn({ prefs: { localOnly: 'true', icloud: 1 } }), false);
});

// ---------------------------------------------------------------- buluta taşıma doğrulaması
test('taşıma doğrulaması: sayı ve boyutlar tutmadan geçiş yapılmaz', () => {
  const expected = [
    { path: 'Tez.docx', size: 1000 },
    { path: 'Bölüm/Giriş.docx', size: 20 },
  ];
  assert.equal(verifyCopy(expected, [...expected, { path: 'README.txt', size: 5 }]).ok, true);
  const missing = verifyCopy(expected, [{ path: 'Tez.docx', size: 1000 }]);
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['Bölüm/Giriş.docx']);
  const wrong = verifyCopy(expected, [
    { path: 'Tez.docx', size: 999 },
    { path: 'Bölüm/Giriş.docx', size: '20' },
  ]);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.mismatched, ['Tez.docx']);
  assert.equal(verifyCopy([], []).ok, true);
});
