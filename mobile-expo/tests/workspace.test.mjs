// Yerel çalışma alanının saf parçaları (src/wsCore.js): node --test mobile-expo/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  countWordsInText,
  docxWordCount,
  countWords,
  buildTreeEntries,
  conflictName,
  decideRemoteChange,
  isLocallyModified,
  classifyChanges,
  buildMessage,
  advanceWords,
  slugify,
  toBase64,
  utf8Encode,
  utf8Decode,
  ignoredName,
  recentlyTouched,
} from '../src/wsCore.js';

async function makeDocx(paragraphs) {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

test('kelime sayımı: harf/rakam içeren parçalar sayılır, noktalama sayılmaz', () => {
  assert.equal(countWordsInText('Merhaba dünya, bu bir   deneme.'), 5);
  assert.equal(countWordsInText('— - ... 42'), 1);
  assert.equal(countWordsInText(''), 0);
});

test('docx kelime sayımı: word/document.xml metni, paragraf sınırları ayrı kelime', async () => {
  const bytes = await makeDocx(['Giriş bölümü', 'İkinci paragraf üç kelime', 'a&amp;b']);
  assert.equal(await docxWordCount(bytes), 2 + 4 + 1);
  assert.equal(await countWords('Tez/Bölüm 1.docx', bytes), 7);
});

test('countWords: sayılmayan tür null, bozuk docx null, metin dosyaları sayılır', async () => {
  assert.equal(await countWords('foto.jpg', new Uint8Array([1, 2, 3])), null);
  assert.equal(await countWords('bozuk.docx', new Uint8Array([1, 2, 3])), null);
  assert.equal(await countWords('notlar.md', utf8Encode('# Başlık\n\nüç kelime var')), 4);
});

test('ağaç girdileri: bloblar + silinenler (sha null), tekrarlar ayıklanır', () => {
  const entries = buildTreeEntries([{ path: 'a.docx', sha: '111' }, { path: 'a.docx', sha: '222' }], ['b.txt', 'a.docx', 'b.txt']);
  assert.deepEqual(entries, [
    { path: 'a.docx', mode: '100644', type: 'blob', sha: '111' },
    { path: 'b.txt', mode: '100644', type: 'blob', sha: null },
  ]);
});

test('çakışma kopyası adı masaüstüyle aynı', () => {
  assert.equal(conflictName('Tez.docx'), 'Tez (diğer cihazdan).docx');
  assert.equal(conflictName('Bölüm/Giriş.docx'), 'Bölüm/Giriş (diğer cihazdan).docx');
  assert.equal(conflictName('README'), 'README (diğer cihazdan)');
});

test('uzak değişiklik kararı: aynı sha atla, yerel dokunulmamışsa indir, ikisi de değiştiyse çakışma', () => {
  const entry = { sha: 'old', size: 10, mtime: 1000 };
  assert.equal(decideRemoteChange(entry, { size: 10, mtime: 1000 }, 'old'), 'skip');
  assert.equal(decideRemoteChange(entry, { size: 10, mtime: 1500 }, 'new'), 'download'); // 1 sn tolerans
  assert.equal(decideRemoteChange(entry, null, 'new'), 'download');
  assert.equal(decideRemoteChange(null, null, 'new'), 'download');
  assert.equal(decideRemoteChange(entry, { size: 11, mtime: 1000 }, 'new'), 'conflict');
  assert.equal(decideRemoteChange(entry, { size: 10, mtime: 9000 }, 'new'), 'conflict');
  assert.equal(isLocallyModified(entry, { size: 10, mtime: 1000 }), false);
});

test('yerel tarama sınıflandırması: değişen / yeni / silinen / büyük', () => {
  const state = { 'a.docx': { sha: '1', size: 5, mtime: 100 }, 'b.docx': { sha: '2', size: 5, mtime: 100 }, 'c.docx': { sha: '3', size: 5, mtime: 100 } };
  const locals = { 'a.docx': { size: 5, mtime: 100 }, 'b.docx': { size: 6, mtime: 100 }, 'yeni.txt': { size: 1, mtime: 1 }, 'video.mp4': { size: 999, mtime: 1 } };
  const r = classifyChanges(state, locals, 100);
  assert.deepEqual(r.modified, ['b.docx']);
  assert.deepEqual(r.added, ['yeni.txt']);
  assert.deepEqual(r.deleted, ['c.docx']);
  assert.deepEqual(r.skipped, [{ path: 'video.mp4', reason: 'tooBig' }]);
});

test('okunamayan dosya "silindi" sayılmaz; atlanan olarak listelenir, izleme kaydı korunur', () => {
  const state = { 'a.docx': { sha: '1', size: 5, mtime: 100 }, 'kilitli.docx': { sha: '2', size: 5, mtime: 100 } };
  const locals = { 'a.docx': { size: 5, mtime: 100 } }; // kilitli.docx stat edilemedi → locals'ta yok
  const r = classifyChanges(state, locals, 100, ['kilitli.docx']);
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(r.skipped, [{ path: 'kilitli.docx', reason: 'unreadable' }]);
  // Gerçekten silinen dosya hâlâ silinmiş sayılır
  assert.deepEqual(classifyChanges(state, {}, 100, ['kilitli.docx']).deleted, ['a.docx']);
});

test('yükleme sırasında yapılan kayıt: okuma anındaki boyut/mtime yazılırsa sonraki tarama değişikliği görür', () => {
  const snapshotAtRead = { size: 5, mtime: 1000 }; // read() içinde alınan hal
  const afterUpload = { size: 7, mtime: 5000 }; // yükleme sürerken Word kaydetti
  const entry = { sha: 'yeni', ...snapshotAtRead };
  assert.equal(isLocallyModified(entry, afterUpload), true); // doğru: tekrar gönderilir
  const wrongEntry = { sha: 'yeni', ...afterUpload }; // yükleme sonrası stat edilseydi
  assert.equal(isLocallyModified(wrongEntry, afterUpload), false); // hata: kayıp düzenleme
});

test('az önce kaydedilmiş (Word açık olabilir) dosyanın üzerine yazılmaz', () => {
  const now = 1_000_000;
  assert.equal(recentlyTouched({ size: 1, mtime: now - 30_000 }, now), true);
  assert.equal(recentlyTouched({ size: 1, mtime: now - 120_000 }, now), false);
  assert.equal(recentlyTouched(null, now), false);
});

test('kelime haritası ilerletme ve kayıt mesajı (masaüstünün okuduğu kuyruk)', () => {
  const { words, delta } = advanceWords({ 'a.docx': 100, 'b.docx': 50 }, { 'a.docx': 120, 'c.txt': 10 }, ['b.docx']);
  assert.deepEqual(words, { 'a.docx': 120, 'c.txt': 10 });
  assert.deepEqual(delta, { 'b.docx': -50, 'a.docx': 20, 'c.txt': 10 });
  const msg = buildMessage({ title: "iPad'de düzenlendi: a.docx", changed: ['a.docx', 'c.txt'], deleted: ['b.docx'], words, delta });
  const idx = msg.indexOf('\n\nacadamiv:');
  assert.ok(idx > 0);
  const meta = JSON.parse(msg.slice(idx + '\n\nacadamiv:'.length).trim());
  assert.equal(meta.v, 1);
  assert.equal(meta.kind, 'mobile');
  assert.deepEqual(meta.changed, ['a.docx', 'c.txt']);
  assert.deepEqual(meta.deleted, ['b.docx']);
  assert.equal(meta.total, 130);
  assert.deepEqual(meta.delta, delta);
  // Kelime bilgisi yoksa words/total yazılmaz (istatistikler sıfıra düşmesin)
  const bare = buildMessage({ title: 'x', changed: ['f.pdf'], deleted: [], words: {}, delta: {} });
  const m2 = JSON.parse(bare.slice(bare.indexOf('acadamiv:') + 'acadamiv:'.length).trim());
  assert.equal(m2.total, undefined);
  assert.equal(m2.words, undefined);
});

test('depo adı slug masaüstüyle aynı', () => {
  assert.equal(slugify('Bitirme Tezi (2026)'), 'bitirme-tezi-2026');
  assert.equal(slugify('Çağrı Şükrü İş'), 'cagri-sukru-is');
  assert.equal(slugify('!!!'), 'tez');
});

test('base64 / utf8 yardımcıları', () => {
  assert.equal(toBase64(utf8Encode('DraftRewind — tez')), Buffer.from('DraftRewind — tez', 'utf8').toString('base64'));
  assert.equal(utf8Decode(utf8Encode('Ğüzel çığ')), 'Ğüzel çığ');
  assert.equal(toBase64(new Uint8Array([1])), 'AQ==');
});

test('izlenmeyen adlar: gizli dosyalar ve Word kilit dosyaları', () => {
  assert.equal(ignoredName('~$Tez.docx'), true);
  assert.equal(ignoredName('.DS_Store'), true);
  assert.equal(ignoredName('Tez.docx'), false);
});
