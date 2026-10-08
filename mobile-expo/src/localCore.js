// Hesapsız (yalnızca bu cihaz) ve iCloud projelerinin saf (React Native'e bağımlı olmayan) parçaları:
// kayıt birleştirme (3 dk), geçmiş seyreltme (masaüstündeki retention.selectKeep'in aynısı),
// _Sürümler dosya adı (masaüstündeki drive.js versionName'in aynısı), başlık kuralı, giriş kararı.
// Node'da test edilir (tests/local.test.mjs).
import { advanceWords } from './wsCore.js';

// Masaüstüyle aynı: aynı dosyanın iki otomatik kaydı arasında en az 3 dakika (config.MIN_SNAPSHOT_GAP_MS)
export const MIN_SNAPSHOT_GAP_MS = 3 * 60 * 1000;
export const DAY = 24 * 3600 * 1000;
// Seyreltmede hiç silinmeyen kayıt türleri (masaüstündeki retention.KEEP_KINDS)
export const KEEP_KINDS = new Set(['star', 'rescue', 'restore', 'merge', 'mobile']);
// Masaüstündeki drive.js ile aynı klasör adları
export const VERSIONS_FOLDER = '_Sürümler';
export const MARKER_FILE = '.draftrewind-proje.json';
export const ICLOUD_ROOT = 'DraftRewind';

const basename = (p) => String(p).split('/').pop();
// Node'un path.extname kuralı: baştaki nokta uzantı sayılmaz (".gizli" → "")
export function extname(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}
export const stem = (p) => {
  const b = basename(p);
  const e = extname(b);
  return e ? b.slice(0, b.length - e.length) : b;
};

// ---------------------------------------------------------------- giriş kararı
// Hesap bağlı değilse de "hesapsız (yalnızca bu cihaz)" ya da iCloud seçildiyse uygulama açılır.
export function isSignedIn({ ghToken, google, prefs } = {}) {
  const p = prefs || {};
  return !!(ghToken || google || p.localOnly === true || p.icloud === true);
}

// ---------------------------------------------------------------- kayıt kaydı
// Yeni kayıt: changed (eklenen+değişen yollar), added (yeni yollar), deleted, counts (kelime sayısı | null),
// prevWords (önceki kelime haritası), files ({ yol: kopya adı }).
export function buildRecord({ id, time, kind = 'auto', title = '', changed = [], added = [], deleted = [], counts = {}, prevWords = {}, files = {} }) {
  const picked = {};
  for (const p of changed) if (counts[p] != null) picked[p] = counts[p];
  const { words, delta } = advanceWords(prevWords, picked, deleted);
  const total = Object.values(words).reduce((a, b) => a + b, 0);
  return {
    id,
    time,
    kind,
    title,
    changed: [...changed],
    added: added.filter((p) => changed.includes(p)),
    deleted: [...deleted],
    delta,
    words,
    total,
    files: { ...files },
  };
}

// Son kayıt, yeni değişikliklerle birleştirilebilir mi? (otomatik ve 3 dakikadan yeni)
export function canCoalesce(last, now = Date.now()) {
  if (!last || last.kind !== 'auto' || last.noCoalesce) return false;
  const age = now - (last.time || 0);
  return age >= 0 && age < MIN_SNAPSHOT_GAP_MS;
}

const uniq = (list) => [...new Set(list)];

// Yeni kaydı (next) son otomatik kayda (last) katar: aynı dosyanın kopyası değiştirilir, yeni kayıt eklenmez.
// next.delta, last'tan sonraki kelime haritasına göre hesaplanmış olmalı (buildRecord prevWords = last.words).
// Dönen: { record, dropped: [eski kopya adları] } — çağıran önce yeni kopyayı yazar, sonra bunları siler.
export function mergeRecord(last, next) {
  const changed = uniq([...last.changed.filter((p) => !next.deleted.includes(p)), ...next.changed]);
  const deleted = uniq([...last.deleted.filter((p) => !next.changed.includes(p)), ...next.deleted]);
  const added = uniq([...(last.added || []), ...(next.added || [])]).filter((p) => changed.includes(p));
  const delta = {};
  for (const p of uniq([...Object.keys(last.delta || {}), ...Object.keys(next.delta || {})])) {
    const d = ((last.delta || {})[p] || 0) + ((next.delta || {})[p] || 0);
    if (d !== 0) delta[p] = d;
  }
  const files = { ...(last.files || {}) };
  const dropped = [];
  for (const [p, name] of Object.entries(next.files || {})) {
    if (files[p] && files[p] !== name) dropped.push(files[p]);
    files[p] = name;
  }
  return {
    record: { ...last, time: next.time, kind: 'auto', title: next.title || last.title, changed, added, deleted, delta, words: next.words, total: next.total, files },
    dropped,
  };
}

// ---------------------------------------------------------------- başlık
// Masaüstüne benzer kural: "<dosya adı>: N kelime eklendi" / "… silindi" / "Yeni dosya: …" / "… güncellendi".
// T: t(anahtar, değişkenler)
export function snapshotTitle({ changed = [], added = [], deleted = [], delta = {} }, T) {
  const sum = Object.values(delta).reduce((a, b) => a + b, 0);
  const wordsNote = sum ? T('local.t.words', { n: sum > 0 ? `+${sum}` : `${sum}`, count: Math.abs(sum) }) : '';
  if (changed.length === 1 && deleted.length === 0) {
    const p = changed[0];
    const d = delta[p] || 0;
    if (added.includes(p)) return T('local.t.added', { name: basename(p) });
    if (d > 0) return T('local.t.wordsAdded', { name: stem(p), n: d, count: d });
    if (d < 0) return T('local.t.wordsRemoved', { name: stem(p), n: -d, count: -d });
    return T('local.t.updated', { name: stem(p) });
  }
  if (changed.length === 0 && deleted.length === 1) return T('local.t.deleted', { name: basename(deleted[0]) });
  const parts = [];
  if (changed.length) parts.push(changed.length === 1 ? T('local.t.updated', { name: stem(changed[0]) }) : T('local.t.many', { name: stem(changed[0]), n: changed.length - 1, count: changed.length - 1 }));
  if (deleted.length) parts.push(T('local.t.deletedCount', { n: deleted.length, count: deleted.length }));
  return (parts.join(', ') || T('local.t.default')) + wordsNote;
}

// ---------------------------------------------------------------- seyreltme
// Masaüstündeki app/core/retention.js selectKeep'in kayıt listesi için uyarlaması.
// list: yeniden eskiye [{ id, time, kind }]. Son 7 gün tümü, 60 güne kadar günde bir, sonrası haftada bir;
// ilk (en yeni) kayıt ve KEEP_KINDS hep kalır. protect: ayrıca korunacak kimlikler (ör. bir dosyanın son kopyası).
export function selectKeep(list, { now = Date.now(), keepAllMs = 7 * DAY, dailyMs = 60 * DAY, protect } = {}) {
  const keep = new Set();
  const dayKey = (t) => Math.floor(t / DAY);
  const weekKey = (t) => Math.floor(t / (7 * DAY));
  const seenDay = new Set();
  const seenWeek = new Set();
  list.forEach((c, i) => {
    const t = c.time;
    const kind = c.kind || 'auto';
    const age = now - t;
    // Liste yeniden eskiye gittiği için ilk görülen = o günün/haftanın SON kaydı
    const key = age < dailyMs ? `d${dayKey(t)}` : `w${weekKey(t)}`;
    const seen = age < dailyMs ? seenDay : seenWeek;
    if (i === 0 || KEEP_KINDS.has(kind) || age < keepAllMs || (protect && protect.has(c.id))) {
      keep.add(c.id);
      seen.add(key);
      return;
    }
    if (!seen.has(key)) {
      seen.add(key);
      keep.add(c.id);
    }
  });
  return keep;
}

// Her dosyanın en yeni kopyasını tutan kayıt kimlikleri: seyreltme bunları asla silmez
// (dosya sonradan silinse bile son hali geri getirilebilsin).
export function latestCopyIds(log) {
  const seen = new Set();
  const ids = new Set();
  for (const r of log) {
    for (const p of Object.keys(r.files || {})) {
      if (seen.has(p)) continue;
      seen.add(p);
      ids.add(r.id);
    }
  }
  return ids;
}

// log (yeniden eskiye) içinde index'teki kayıttan DAHA ESKİ ve path'in kopyası olan ilk kayıt
export function previousCopy(log, index, path) {
  for (let i = index + 1; i < log.length; i++) if (log[i].files && log[i].files[path]) return log[i];
  return null;
}

// ---------------------------------------------------------------- _Sürümler adları (masaüstüyle aynı)
// app/core/drive.js: safeName / stamp / versionName
export function desktopSafeName(s) {
  return String(s).replace(/[<>:"/\\|?*]/g, '-').trim();
}
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}
// "2026-10-08 14.05 Tez.docx", yıldızlıysa "2026-10-08 14.05 Tez (yıldızlı).docx"
export function versionName(rel, kind, { date = new Date(), suffix = '', starTag = 'yıldızlı' } = {}) {
  const ext = extname(rel);
  const base = stem(rel);
  return desktopSafeName(`${stamp(date)} ${base}${kind === 'star' ? ` (${starTag})` : ''}${suffix}${ext}`);
}
// _Sürümler/<alt klasörler> (masaüstü: path.join(dir, VERSIONS, ...rel.split('/').slice(0, -1)))
export const versionDirParts = (rel) => [VERSIONS_FOLDER, ...String(rel).split('/').slice(0, -1)];

// Yerel geçmiş kopyası: ws-history/<proje>/<kodlanmış yol>/<zaman>.<uzantı>
export const historyKey = (path) => encodeURIComponent(path);
export const copyFileName = (time, path) => `${time}${extname(path) || '.bin'}`;

// ---------------------------------------------------------------- buluta taşıma doğrulaması
// Kopyalama sonrası karar: beklenen her dosya hedefte aynı boyutla var mı? (sayı + boyut)
// expected / got: [{ path, size }]. ok false ise asıllara dokunulmaz, geçiş yapılmaz.
export function verifyCopy(expected, got) {
  const have = new Map();
  for (const g of got || []) have.set(g.path, g.size);
  const missing = [];
  const mismatched = [];
  for (const e of expected || []) {
    if (!have.has(e.path)) missing.push(e.path);
    else if (Number(have.get(e.path)) !== Number(e.size)) mismatched.push(e.path);
  }
  const ok = !missing.length && !mismatched.length && (expected || []).length <= have.size;
  return { ok, missing, mismatched };
}
