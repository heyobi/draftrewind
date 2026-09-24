// Yerel çalışma alanının saf (React Native'e bağımlı olmayan) parçaları: kelime sayımı, ağaç girdileri,
// çakışma kararı, kayıt mesajı. Node'da test edilir (tests/workspace.test.mjs).
import JSZip from 'jszip';

// Masaüstüyle aynı kural: boşlukla ayrılan ve içinde harf/rakam olan her parça bir kelimedir.
export function countWordsInText(text) {
  let n = 0;
  for (const w of String(text || '').split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

// Hermes'te TextDecoder her sürümde yok; küçük bir UTF-8 çözücü
export function utf8Decode(bytes) {
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder().decode(bytes);
    } catch (e) {}
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++];
    if (b < 0x80) out += String.fromCharCode(b);
    else if (b < 0xe0) out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b < 0xf0) out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

export function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

const ext = (path) => (String(path).split('.').pop() || '').toLowerCase();
// Kelime sayılan türler (masaüstüyle aynı küme: Word belgeleri ve düz metin)
export const countsWords = (path) => ['docx', 'txt', 'md', 'tex'].includes(ext(path));

// Word belgesinin ana metnindeki kelimeler (word/document.xml; paragraf sonları boşluk sayılır)
export async function docxWordCount(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) return null;
  const xml = await entry.async('string');
  const text = xml
    .replace(/<w:tab\/>/g, ' ')
    .replace(/<\/w:(p|tc|br)>|<w:br\/>|<w:cr\/>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
  return countWordsInText(text);
}

// Dosya türüne göre kelime sayısı; sayılmayan tür ya da bozuk dosya → null
export async function countWords(path, bytes) {
  if (!countsWords(path)) return null;
  try {
    if (ext(path) === 'docx') return await docxWordCount(bytes);
    return countWordsInText(utf8Decode(bytes));
  } catch (e) {
    return null;
  }
}

// Git ağacı girdileri: yeni/değişen bloblar + silinenler (sha: null → yoldan kaldır)
export function buildTreeEntries(blobs, removals) {
  const seen = new Set();
  const out = [];
  for (const b of blobs || []) {
    if (seen.has(b.path)) continue;
    seen.add(b.path);
    out.push({ path: b.path, mode: '100644', type: 'blob', sha: b.sha });
  }
  for (const path of removals || []) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, mode: '100644', type: 'blob', sha: null });
  }
  return out;
}

// "Tez/Bölüm 1.docx" → "Tez/Bölüm 1 (diğer cihazdan).docx" (masaüstüyle aynı ad)
export function conflictName(path) {
  const slash = path.lastIndexOf('/');
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const e = dot > 0 ? name.slice(dot) : '';
  return `${slash >= 0 ? path.slice(0, slash + 1) : ''}${base} (diğer cihazdan)${e}`;
}

// Yerel dosya, son indirme/gönderme anından beri değişmiş mi? (mtime ya da boyut farklıysa)
export function isLocallyModified(entry, local) {
  if (!entry || !local) return false;
  if (local.size !== entry.size) return true;
  return Math.abs((local.mtime || 0) - (entry.mtime || 0)) > 1000;
}

// Uzaktaki dosya değişmiş; ne yapılmalı?
//   'skip'     : uzaktaki hali zaten bizde (sha aynı)
//   'download' : yerel dosya değişmemiş ya da yok → üzerine yaz
//   'conflict' : yerel de değişmiş → yerel kalır, uzaktaki "(diğer cihazdan)" kopyası olur
export function decideRemoteChange(entry, local, remoteSha) {
  if (entry && entry.sha === remoteSha) return 'skip';
  if (!local || !entry) return 'download';
  return isLocallyModified(entry, local) ? 'conflict' : 'download';
}

// Yerel taramayı duruma göre sınıflandırır. locals: { [path]: { size, mtime } }, state.files: { [path]: { sha, size, mtime } }
export function classifyChanges(stateFiles, locals, maxSize) {
  const modified = [];
  const added = [];
  const deleted = [];
  const skipped = [];
  for (const path of Object.keys(locals)) {
    const local = locals[path];
    const entry = stateFiles[path];
    if (local.size > maxSize) {
      if (!entry || isLocallyModified(entry, local)) skipped.push({ path, reason: 'tooBig' });
      continue;
    }
    if (!entry) added.push(path);
    else if (isLocallyModified(entry, local)) modified.push(path);
  }
  for (const path of Object.keys(stateFiles)) if (!locals[path]) deleted.push(path);
  return { modified, added, deleted, skipped };
}

// Kayıt mesajı: başlık + masaüstünün okuduğu "acadamiv:" kuyruğu.
// words: kayıttan sonraki kelime haritası (bilinmiyorsa null), delta: bu kayıttaki değişimler
export function buildMessage({ title, changed, deleted, words, delta }) {
  const meta = { v: 1, kind: 'mobile', changed: changed || [], deleted: deleted || [] };
  if (delta && Object.keys(delta).length) meta.delta = delta;
  if (words && Object.keys(words).length) {
    meta.words = words;
    meta.total = Object.values(words).reduce((a, b) => a + b, 0);
  }
  return `${title}\n\nacadamiv: ${JSON.stringify(meta)}\n`;
}

// Kelime haritasını bu kaydın sayımlarıyla ilerletir → { words, delta }
export function advanceWords(prevWords, counts, deleted) {
  const words = { ...(prevWords || {}) };
  const delta = {};
  for (const path of deleted || []) {
    if (words[path] != null) delta[path] = -words[path];
    delete words[path];
  }
  for (const path of Object.keys(counts || {})) {
    const n = counts[path];
    if (n == null) continue;
    const d = n - (words[path] || 0);
    if (d !== 0 || words[path] == null) delta[path] = d;
    words[path] = n;
  }
  return { words, delta };
}

// Masaüstüyle aynı depo adı: draftrewind-<slug>
export function slugify(name) {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
  return (
    String(name)
      .replace(/[çğıöşüÇĞİÖŞÜ]/g, (c) => map[c])
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tez'
  );
}

// Word'ün kilit dosyaları (~$ad.docx), gizli dosyalar ve sistem artıkları izlenmez
export const ignoredName = (name) => name.startsWith('.') || name.startsWith('~$') || name === 'Thumbs.db' || name === 'desktop.ini';
