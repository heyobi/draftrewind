// Hesapsız (yalnızca bu cihaz) ve iCloud Drive projeleri: git yok, sunucu yok.
//
// Yerel proje : Belgeler/Projeler/<ad>/ (Dosyalar › DraftRewind › Projeler, çalışma alanlarıyla aynı yer).
//               Sürüm kopyaları Belgeler/ws-history/<ad>/<kodlanmış yol>/<zaman>.<uzantı> (Dosyalar'da görünmez),
//               kayıt listesi ws-history/<ad>/log.json, tarama durumu ws-state/local-<ad>.json.
// iCloud projesi: <kapsayıcı>/Documents/DraftRewind/<ad>/ ; sürüm kopyaları masaüstünün Google Drive/Klasör
//               moduyla AYNI düzende: <ad>/_Sürümler/<alt klasör>/<YYYY-AA-GG SS.dd> <dosya> ; işaret dosyası
//               .draftrewind-proje.json. Kayıt listesi yine bu cihazda (ws-history/iCloud~<ad>/log.json, eşitlenmez).
//
// Veri güvenliği: kopya önce yazılır ve doğrulanır, sonra eskisi silinir; dosyalar geçici ad + taşıma ile
// atomik yazılır; son 60 sn içinde değişmiş dosyanın üzerine geri yükleme yapılmaz.
import { Directory, File, Paths } from 'expo-file-system';
import { MAX_UPLOAD, fileType, safeName, uniqueName } from './files';
import { t, lang } from './i18n';
import { countWords, countsWords, classifyChanges, ignoredName, recentlyTouched, buildMessage } from './wsCore';
import * as GH from './github';
import * as IC from './icloud';
import * as Core from './localCore';
import * as WS from './workspace';
import { plainBytes } from './bytes';

const { ROOT_FOLDER, claimedFolders } = WS;

const localRoot = () => new Directory(Paths.document, ROOT_FOLDER);
const stateDir = () => new Directory(Paths.document, 'ws-state');
const histRoot = () => new Directory(Paths.document, 'ws-history');

export const projectKey = (p) => (p.store === 'icloud' ? `iCloud~${p.folder}` : p.folder);
export function projectDir(p) {
  return p.store === 'icloud' ? new Directory(p.rootUri, p.folder) : new Directory(localRoot(), p.folder);
}
const historyDir = (p) => new Directory(histRoot(), projectKey(p));
const logFile = (p) => new File(historyDir(p), 'log.json');
const stateFile = (p) => new File(stateDir(), `local-${projectKey(p)}.json`);
const icloudCacheFile = () => new File(stateDir(), 'icloud-projects.json');

// Kullanıcıya gösterilecek hata (ham iz yok)
function userError(code, key, vars) {
  const e = new Error(t(key, vars));
  e.code = code;
  e.user = true;
  return e;
}

const nfc = (s) => {
  try {
    return String(s).normalize('NFC');
  } catch (e) {
    return String(s);
  }
};

// ---------------------------------------------------------------- dosya yardımcıları
function statFile(file) {
  try {
    if (!file.exists) return null;
    return { size: file.size, mtime: file.modificationTime || 0 };
  } catch (e) {
    return null;
  }
}

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// Geçici dosyaya yaz → hedefin üstüne taşı. Taşıma olmazsa hedefe dokunulmaz ve hata fırlatılır.
export function atomicWrite(file, bytes) {
  const dir = file.parentDirectory;
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `.dr-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    tmp.write(plainBytes(bytes));
    tmp.moveSync(file, { overwrite: true });
  } catch (e) {
    try {
      if (tmp.exists) tmp.delete();
    } catch (e2) {}
    throw e;
  }
  // Doğrulama: boyut tutmuyorsa yazılmamış say
  const s = statFile(file);
  if (!s || s.size !== bytes.length) throw userError('verify', 'local.writeFailed', { name: file.name });
  return file;
}

function readJson(file, fallback) {
  try {
    if (!file.exists) return fallback;
    const v = JSON.parse(file.textSync());
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  const text = JSON.stringify(value);
  const dir = file.parentDirectory;
  dir.create({ intermediates: true, idempotent: true });
  const tmp = new File(dir, `.dr-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    tmp.write(text);
    tmp.moveSync(file, { overwrite: true });
  } catch (e) {
    try {
      if (tmp.exists) tmp.delete();
    } catch (e2) {}
    file.write(text);
  }
}

const safeDelete = (item) => {
  try {
    if (item && item.exists) item.delete();
  } catch (e) {}
};

// ---------------------------------------------------------------- durum ve kayıt listesi
const EMPTY = () => ({ files: {}, created: null, lastThin: 0 });
export function loadState(p) {
  const st = readJson(stateFile(p), null);
  if (!st || typeof st !== 'object') return EMPTY();
  return { ...EMPTY(), ...st, files: st.files && typeof st.files === 'object' ? st.files : {} };
}
function saveState(p, st) {
  writeJson(stateFile(p), st);
}

// Kayıtlar yeniden eskiye
export function loadLog(p) {
  const log = readJson(logFile(p), []);
  return Array.isArray(log) ? log.filter((r) => r && typeof r === 'object' && r.id && r.time) : [];
}
function saveLog(p, log) {
  writeJson(logFile(p), log);
}

// ---------------------------------------------------------------- tarama
// iCloud'da indirilmemiş öğeler (eski iOS) ".Ad.docx.icloud" yer tutucusu olarak görünür
const PLACEHOLDER = /^\.(.+)\.icloud$/;

function walk(p, dir, prefix, out, unreadable, placeholders) {
  let items;
  try {
    items = dir.list();
  } catch (e) {
    return;
  }
  for (const it of items) {
    const name = it.name;
    if (!name) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (p.store === 'icloud' && !prefix && nfc(name) === nfc(Core.VERSIONS_FOLDER)) continue;
    const ph = PLACEHOLDER.exec(name);
    if (ph && p.store === 'icloud' && !(it instanceof Directory)) {
      const real = prefix ? `${prefix}/${ph[1]}` : ph[1];
      unreadable.push(real); // silinmiş sayılmasın
      placeholders.push(real);
      IC.nudgeDownload(new File(dir, ph[1]));
      continue;
    }
    if (ignoredName(name)) continue;
    if (it instanceof Directory) walk(p, it, rel, out, unreadable, placeholders);
    else {
      const s = statFile(it);
      if (s) out[rel] = s;
      else unreadable.push(rel);
    }
  }
}

function scanDir(p) {
  const locals = {};
  const unreadable = [];
  const placeholders = [];
  const dir = projectDir(p);
  if (dir.exists) walk(p, dir, '', locals, unreadable, placeholders);
  return { locals, unreadable, placeholders };
}

// Belgeler sekmesi: [{ path, size, mtime, placeholder? }]
export function listFiles(p) {
  const { locals, placeholders } = scanDir(p);
  const out = Object.entries(locals).map(([path, s]) => ({ path, size: s.size, mtime: s.mtime }));
  for (const path of placeholders) if (!locals[path]) out.push({ path, size: 0, mtime: 0, placeholder: true });
  return out;
}

export const workFile = (p, path) => new File(projectDir(p), ...path.split('/'));
const copyRef = (p, rel) => (p.store === 'icloud' ? new File(projectDir(p), ...rel.split('/')) : new File(historyDir(p), ...rel.split('/')));

async function ensureReadable(p, file) {
  if (p.store !== 'icloud') return true;
  return IC.ensureDownloaded(file);
}

// iCloud oturumu kapandıysa (kapsayıcı yok) iCloud işlemleri durur
async function assertStore(p) {
  if (p.store !== 'icloud') return;
  const path = await IC.containerPath(true);
  if (!path || !projectDir(p).exists) throw userError('icloudGone', 'icloud.goneBody');
}

const starTag = () => (lang() === 'tr' ? 'yıldızlı' : 'starred');
const newId = (now) => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// Değişen dosyanın kopyasını yazar → göreli kopya adı (record.files değeri)
async function writeCopy(p, path, bytes, now, kind, replacing) {
  if (p.store === 'icloud') {
    const parts = Core.versionDirParts(path);
    const dir = new Directory(projectDir(p), ...parts);
    dir.create({ intermediates: true, idempotent: true });
    let name = Core.versionName(path, kind, { date: new Date(now), starTag: starTag() });
    const same = replacing && replacing === [...parts, name].join('/');
    // Aynı dakikada başka bir kaydın kopyası varsa ezilmez: "(2)" eklenir
    if (!same) name = await uniqueName(name, async (n) => new File(dir, n).exists);
    atomicWrite(new File(dir, name), bytes);
    return [...parts, name].join('/');
  }
  const key = Core.historyKey(path);
  let name = Core.copyFileName(now, path);
  const dir = new Directory(historyDir(p), key);
  if (replacing !== `${key}/${name}`) name = await uniqueName(name, async (n) => new File(dir, n).exists);
  atomicWrite(new File(dir, name), bytes);
  return `${key}/${name}`;
}

// Kayıt noktası: değişen her dosyanın (≤ 50 MB) kopyası alınır, log.json'a bir kayıt eklenir.
// Son otomatik kayıt 3 dakikadan yeniyse yeni kayıt açılmaz, onunla birleştirilir (kopya değiştirilir).
// Dönen: { record, merged, skipped: [{ path, reason }] }
async function doSnapshot(p, { kind = 'auto', title, force = false, coalesce = true, noCoalesce = false } = {}) {
  await assertStore(p);
  const dir = projectDir(p);
  if (!dir.exists) return { record: null, merged: false, skipped: [] };
  const st = loadState(p);
  const { locals, unreadable } = scanDir(p);
  const r = classifyChanges(st.files, locals, MAX_UPLOAD, unreadable);
  const skipped = [...r.skipped];
  const candidates = [...r.modified, ...r.added];
  if (!force && !candidates.length && !r.deleted.length) return { record: null, merged: false, skipped };

  const log = loadLog(p);
  const now = Date.now();
  const last = log[0];
  const merge = coalesce && kind === 'auto' && Core.canCoalesce(last, now);
  const prevWords = (last && last.words) || {};
  const counts = {};
  const files = {};
  const done = [];
  const tracked = {};
  for (const path of candidates) {
    const file = workFile(p, path);
    try {
      if (!(await ensureReadable(p, file))) {
        skipped.push({ path, reason: 'unreadable' });
        continue;
      }
      // Boyut/mtime okumadan ÖNCE: okurken kaydedilirse sonraki taramada yine değişmiş görünür
      const snap = statFile(file);
      const bytes = await file.bytes();
      if (countsWords(path)) counts[path] = await countWords(path, bytes);
      const replacing = merge && last.files ? last.files[path] : null;
      files[path] = await writeCopy(p, path, bytes, now, kind, replacing);
      tracked[path] = snap || { size: bytes.length, mtime: now };
      done.push(path);
    } catch (e) {
      skipped.push({ path, reason: 'unreadable' });
    }
  }
  if (!force && !done.length && !r.deleted.length) return { record: null, merged: false, skipped };

  let record = Core.buildRecord({ id: newId(now), time: now, kind, changed: done, added: r.added.filter((x) => done.includes(x)), deleted: r.deleted, counts, prevWords, files });
  let dropped = [];
  if (merge) {
    const m = Core.mergeRecord(last, record);
    record = m.record;
    dropped = m.dropped;
    record.title = title || Core.snapshotTitle(record, t);
    log[0] = record;
  } else {
    record.title = title || Core.snapshotTitle(record, t);
    if (noCoalesce) record.noCoalesce = true;
    log.unshift(record);
  }
  // Sıra: kopyalar (yazıldı) → kayıt listesi → durum → eski kopyalar silinir
  saveLog(p, log);
  for (const path of done) st.files[path] = tracked[path];
  for (const path of r.deleted) delete st.files[path];
  if (!st.created) st.created = now;
  saveState(p, st);
  const live = new Set(Object.values(record.files || {}));
  for (const rel of dropped) if (!live.has(rel)) safeDelete(copyRef(p, rel));
  // Seyreltme günde en fazla bir kez
  if (Date.now() - (st.lastThin || 0) > Core.DAY) thin(p);
  return { record, merged: merge, skipped };
}

// Eski otomatik kayıtları seyreltir (masaüstüyle aynı kural); her dosyanın son kopyası hep kalır
export function thin(p, opts = {}) {
  const log = loadLog(p);
  const keep = Core.selectKeep(log, { ...opts, protect: Core.latestCopyIds(log) });
  const kept = log.filter((r) => keep.has(r.id));
  const removed = log.filter((r) => !keep.has(r.id));
  if (removed.length) {
    saveLog(p, kept);
    const live = new Set();
    for (const r of kept) for (const rel of Object.values(r.files || {})) live.add(rel);
    for (const r of removed) for (const rel of Object.values(r.files || {})) if (!live.has(rel)) safeDelete(copyRef(p, rel));
  }
  const st = loadState(p);
  st.lastThin = Date.now();
  saveState(p, st);
  return { removed: removed.length, kept: kept.length };
}

// Aynı proje için aynı anda tek iş
const inflight = new Map();
function exclusive(p, job) {
  const key = `${p.store}:${p.folder}`;
  const prev = inflight.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(job);
  const tail = next.catch(() => {});
  inflight.set(key, tail);
  tail.then(() => {
    if (inflight.get(key) === tail) inflight.delete(key);
  });
  return next;
}

export const snapshot = (p, opts) => exclusive(p, () => doSnapshot(p, opts));

// "Bu anı işaretle": değişiklik olmasa da yıldızlı kayıt
export const markMoment = (p, title) => exclusive(p, () => doSnapshot(p, { kind: 'star', title, force: true, coalesce: false }));

// Tüm projeleri tarar (ana ekran açılışı / öne gelme). Dönen: yeni ya da güncellenen kayıt sayısı.
export async function snapshotAll(projects) {
  let n = 0;
  for (const p of projects) {
    try {
      const r = await snapshot(p);
      if (r && r.record) n++;
    } catch (e) {}
  }
  return n;
}

// ---------------------------------------------------------------- okuma
export async function readCurrent(p, path) {
  const f = workFile(p, path);
  if (!(await ensureReadable(p, f))) throw userError('notDownloaded', 'icloud.notDownloaded', { name: path.split('/').pop() });
  return toArrayBuffer(await f.bytes());
}

// Bir kaydın bir dosyasının kopyası (yoksa null)
export async function readCopy(p, record, path) {
  const rel = record && record.files ? record.files[path] : null;
  if (!rel) return null;
  const f = copyRef(p, rel);
  if (!(await ensureReadable(p, f))) throw userError('notDownloaded', 'icloud.notDownloaded', { name: path.split('/').pop() });
  if (!f.exists) throw userError('copyMissing', 'local.copyMissing');
  return toArrayBuffer(await f.bytes());
}

// ---------------------------------------------------------------- geri yükleme
// Kopyayı proje klasörüne geri yazar. Önce mevcut hal kaydedilir (geri alma da geri alınabilir).
export function restoreVersion(p, record, path) {
  return exclusive(p, async () => {
    await assertStore(p);
    const rel = record && record.files ? record.files[path] : null;
    if (!rel) throw userError('copyMissing', 'local.copyMissing');
    const copy = copyRef(p, rel);
    if (!(await ensureReadable(p, copy)) || !copy.exists) throw userError('copyMissing', 'local.copyMissing');
    // Eski hal ÖNCE belleğe alınır (aşağıdaki kayıt noktası seyreltme/birleştirme yapsa bile kaybolmaz)
    const bytes = await copy.bytes();
    const target = workFile(p, path);
    const local = statFile(target);
    if (local && recentlyTouched(local)) throw userError('recent', 'local.restoreRecent', { name: path.split('/').pop() });
    await doSnapshot(p, { kind: 'auto', title: t('local.beforeRestore'), coalesce: false, noCoalesce: true });
    atomicWrite(target, bytes);
    const d = new Date(record.time);
    const label = `${t('day.date', { d: d.getDate(), month: t('months')[d.getMonth()] })} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
    return doSnapshot(p, { kind: 'restore', title: t('local.restored', { name: path.split('/').pop(), stamp: label }), force: true, coalesce: false });
  });
}

// ---------------------------------------------------------------- dosya ekleme
// Seçilen dosyaları proje köküne kopyalar (aynı ad varsa "(2)"), sonra kayıt noktası alır.
export function addFiles(p, assets) {
  return exclusive(p, async () => {
    await assertStore(p);
    const dir = projectDir(p);
    dir.create({ intermediates: true, idempotent: true });
    const done = [];
    const failed = [];
    for (const a of assets) {
      try {
        const name = await uniqueName(safeName(a.name), async (n) => new File(dir, n).exists);
        const bytes = await new File(a.uri).bytes();
        atomicWrite(new File(dir, name), bytes);
        done.push(name);
      } catch (e) {
        failed.push(a.name);
      }
    }
    const r = done.length ? await doSnapshot(p) : null;
    return { done, failed, record: r && r.record };
  });
}

// ---------------------------------------------------------------- proje listeleri
function logInfo(p) {
  const log = loadLog(p);
  return { modified: log.length ? log[0].time : 0, count: log.length };
}

// Bu cihazdaki yerel projeler. GitHub çalışma alanı olan klasörler (ws-state/<sahip>__<depo>.json
// ya da şu an listelenen GitHub projelerinin adları) yerel proje sayılmaz.
export function listLocalProjects(ghFolderNames = []) {
  const root = localRoot();
  if (!root.exists) return [];
  const claimed = new Set([...claimedFolders(), ...ghFolderNames].map(nfc));
  const out = [];
  let items = [];
  try {
    items = root.list();
  } catch (e) {
    return [];
  }
  for (const it of items) {
    if (!(it instanceof Directory) || !it.name || ignoredName(it.name)) continue;
    if (claimed.has(nfc(it.name))) continue;
    const p = { id: `local:${it.name}`, name: it.name, folder: it.name, store: 'local' };
    out.push({ ...p, ...logInfo(p) });
  }
  return out.sort((a, b) => (b.modified || 0) - (a.modified || 0) || a.name.localeCompare(b.name));
}

// iCloud kökü: <kapsayıcı>/Documents/DraftRewind (create: yoksa oluştur)
export async function icloudRoot(create = false, force = false) {
  const docs = await IC.containerDir(force);
  if (!docs) return null;
  const root = new Directory(docs, Core.ICLOUD_ROOT);
  if (create) root.create({ intermediates: true, idempotent: true });
  return root;
}

// iCloud projeleri → { available, projects }. iCloud kapandıysa son bilinen liste (salt okunur) döner.
export async function listIcloudProjects(force = false) {
  const root = await icloudRoot(false, force);
  if (!root) return { available: false, projects: readJson(icloudCacheFile(), []).map((x) => ({ ...x, store: 'icloud', unavailable: true })) };
  const out = [];
  if (root.exists) {
    let items = [];
    try {
      items = root.list();
    } catch (e) {}
    for (const it of items) {
      if (!(it instanceof Directory) || !it.name || ignoredName(it.name)) continue;
      const p = { id: `icloud:${it.name}`, name: it.name, folder: it.name, store: 'icloud', rootUri: root.uri };
      out.push({ ...p, ...logInfo(p) });
    }
  }
  out.sort((a, b) => (b.modified || 0) - (a.modified || 0) || a.name.localeCompare(b.name));
  try {
    stateDir().create({ intermediates: true, idempotent: true });
    writeJson(
      icloudCacheFile(),
      out.map(({ id, name, folder, modified }) => ({ id, name, folder, modified }))
    );
  } catch (e) {}
  return { available: true, projects: out };
}

// Masaüstündeki FolderRemote'un işaret dosyası (aynı biçim)
function writeMarker(dir, name, id) {
  try {
    new File(dir, Core.MARKER_FILE).write(JSON.stringify({ id, name, note: 'DraftRewind bu klasörü eşitliyor. Bu dosyayı silmeyin.' }));
  } catch (e) {}
}

// Yeni proje. store: 'local' | 'icloud'. Aynı adlı klasör varsa hata (kullanıcı başka ad seçer).
export async function createProject(rawName, store = 'local') {
  const name = String(rawName || '').trim();
  const folder = safeName(name);
  let p;
  if (store === 'icloud') {
    const root = await icloudRoot(true, true);
    if (!root) throw userError('icloudGone', 'icloud.goneBody');
    p = { id: `icloud:${folder}`, name: folder, folder, store: 'icloud', rootUri: root.uri };
  } else {
    p = { id: `local:${folder}`, name: folder, folder, store: 'local' };
    if (claimedFolders().map(nfc).includes(nfc(folder))) throw userError('taken', 'home.newProjectNameTaken');
  }
  const dir = projectDir(p);
  if (dir.exists) throw userError('taken', 'home.newProjectNameTaken');
  dir.create({ intermediates: true, idempotent: true });
  if (store === 'icloud') writeMarker(dir, name, `m-${newId(Date.now())}`);
  saveState(p, { ...EMPTY(), created: Date.now() });
  return { ...p, modified: 0, count: 0 };
}

export const filesPath = (p) => (p.store === 'icloud' ? `iCloud Drive › DraftRewind › ${Core.ICLOUD_ROOT} › ${p.folder}` : `DraftRewind › ${ROOT_FOLDER} › ${p.folder}`);

// ---------------------------------------------------------------- yerelden iCloud'a taşıma
// Her proje için: klasör + geçmiş kopyaları iCloud'a kopyalanır, hepsi (boyutlarıyla) doğrulanır,
// ancak ondan sonra yerel asıllar silinir. Hata olursa asıllar yerinde kalır, yarım kopya temizlenir.
// onProgress(i, n, name). Dönen: { moved: [ad], failed: [ad] }
export async function moveLocalToIcloud(projects, onProgress) {
  const root = await icloudRoot(true, true);
  if (!root) throw userError('icloudGone', 'icloud.goneBody');
  const moved = [];
  const failed = [];
  for (let i = 0; i < projects.length; i++) {
    const src = projects[i];
    if (onProgress) onProgress(i, projects.length, src.name);
    try {
      await exclusive(src, () => moveOne(src, root));
      moved.push(src.name);
    } catch (e) {
      failed.push(src.name);
    }
  }
  return { moved, failed };
}

function listAll(dir, prefix, out) {
  let items = [];
  try {
    items = dir.list();
  } catch (e) {
    return;
  }
  for (const it of items) {
    if (!it.name || ignoredName(it.name)) continue;
    const rel = prefix ? `${prefix}/${it.name}` : it.name;
    if (it instanceof Directory) listAll(it, rel, out);
    else out.push(rel);
  }
}

async function moveOne(src, root) {
  // Önce son hal kaydedilsin (taşıma sırasında değişiklik kaybolmasın)
  await doSnapshot(src);
  const folder = await uniqueName(src.folder, async (n) => new Directory(root, n).exists);
  const dst = { id: `icloud:${folder}`, name: folder, folder, store: 'icloud', rootUri: root.uri };
  const dstDir = projectDir(dst);
  const srcDir = projectDir(src);
  try {
    dstDir.create({ intermediates: true, idempotent: true });
    writeMarker(dstDir, src.name, `m-${newId(Date.now())}`);
    // 1) Güncel dosyalar
    const paths = [];
    listAll(srcDir, '', paths);
    const state = { ...EMPTY(), created: loadState(src).created || Date.now() };
    const before = {};
    for (const path of paths) {
      const from = workFile(src, path);
      const sb = statFile(from);
      // Az önce kaydedilmiş (Word'de açık olabilir) dosya varsa bu proje şimdi taşınmaz
      if (sb && recentlyTouched(sb)) throw userError('recent', 'local.restoreRecent', { name: path.split('/').pop() });
      before[path] = sb;
      const bytes = await from.bytes();
      const to = workFile(dst, path);
      atomicWrite(to, bytes);
      const s = statFile(to);
      if (!s || s.size !== bytes.length) throw new Error('verify');
      state.files[path] = s;
    }
    // 2) Geçmiş kopyaları → _Sürümler (masaüstü adlarıyla)
    const log = loadLog(src);
    const newLog = [];
    const used = new Set();
    for (const r of log) {
      const files = {};
      for (const [path, rel] of Object.entries(r.files || {})) {
        const from = copyRef(src, rel);
        if (!from.exists) continue;
        const bytes = await from.bytes();
        const parts = Core.versionDirParts(path);
        const vdir = new Directory(dstDir, ...parts);
        vdir.create({ intermediates: true, idempotent: true });
        const name = await uniqueName(Core.versionName(path, r.kind, { date: new Date(r.time), starTag: starTag() }), async (n) => used.has([...parts, n].join('/')) || new File(vdir, n).exists);
        const to = new File(vdir, name);
        atomicWrite(to, bytes);
        const s = statFile(to);
        if (!s || s.size !== bytes.length) throw new Error('verify');
        files[path] = [...parts, name].join('/');
        used.add(files[path]);
      }
      newLog.push({ ...r, files });
    }
    // Kopyalarken asıllardan biri değiştiyse asıllar silinmez (yeni hali kaybolmasın)
    for (const path of paths) {
      const now = statFile(workFile(src, path));
      const b = before[path];
      if (!now || !b || now.size !== b.size || now.mtime !== b.mtime) throw new Error('changed');
    }
    const after = [];
    listAll(srcDir, '', after);
    if (after.length !== paths.length) throw new Error('changed');
    saveLog(dst, newLog);
    saveState(dst, state);
  } catch (e) {
    // Yarım kopya temizlenir; asıllar olduğu gibi kalır
    safeDelete(dstDir);
    safeDelete(historyDir(dst));
    safeDelete(stateFile(dst));
    throw e;
  }
  // 3) Her şey doğrulandı: yerel asıllar silinir
  safeDelete(srcDir);
  safeDelete(historyDir(src));
  safeDelete(stateFile(src));
  return dst;
}

// ---------------------------------------------------------------- buluta taşıma (GitHub / Google Drive)
// Ortak kural: önce kopyala, sonra doğrula (sayı + boyut), ancak ondan sonra geçiş yap. Hata olursa
// kullanıcının dosyalarına dokunulmaz. 50 MB üstü dosyalar buluta gönderilemez: o zaman yerel klasör silinmez.

// Klasördeki dosyalar: { eligible: [{ path, size, mtime }], tooBig: [path] }
function cloudCandidates(p) {
  const { locals } = scanDir(p);
  const eligible = [];
  const tooBig = [];
  for (const [path, s] of Object.entries(locals)) {
    if (s.size > MAX_UPLOAD) tooBig.push(path);
    else eligible.push({ path, size: s.size, mtime: s.mtime });
  }
  eligible.sort((a, b) => a.path.localeCompare(b.path));
  return { eligible, tooBig };
}

// GitHub: depo (yeni proje akışıyla aynı) → tüm dosyalar TEK kayıtta → klasör o projenin çalışma alanı olur
// (ws-state/<sahip>__<depo>.json; sha/mtime'larla, yeniden gönderilmez). Sürüm kopyaları cihazda kalır.
// onProgress(i, n). Dönen: { project, tooBig }
export function moveToGithub(token, p, onProgress) {
  return exclusive(p, async () => {
    await doSnapshot(p).catch(() => null); // son hal yerel geçmişe de girsin
    const { eligible, tooBig } = cloudCandidates(p);
    const gh = await GH.createProject(token, p.name, t('home.newProjectReadme'));
    const counts = {};
    const snaps = {};
    const files = eligible.map((f) => ({
      path: f.path,
      read: async () => {
        const file = workFile(p, f.path);
        snaps[f.path] = statFile(file);
        const bytes = await file.bytes();
        if (countsWords(f.path)) counts[f.path] = await countWords(f.path, bytes);
        return file.base64();
      },
    }));
    let words = {};
    const r = files.length
      ? await GH.commitChanges(
          token,
          gh,
          files,
          [],
          (uploaded) => {
            const picked = {};
            for (const path of uploaded) if (counts[path] != null) picked[path] = counts[path];
            words = picked;
            return buildMessage({ title: t('move.ghCommit', { name: p.name }), changed: uploaded, deleted: [], words: picked, delta: picked });
          },
          (i) => onProgress && onProgress(i, files.length)
        )
      : { done: [], failed: [], commit: null };
    if (r.failed.length) throw userError('verify', 'move.verifyFailed');
    // Doğrulama: GitHub'daki ağaç (yol + boyut)
    if (eligible.length) {
      const remote = await GH.listFiles(token, gh, r.commit);
      const v = Core.verifyCopy(eligible, remote);
      if (!v.ok) throw userError('verify', 'move.verifyFailed');
    }
    // Geçiş: klasör (aynı ad → aynı Belgeler/Projeler/<ad>) artık GitHub projesinin çalışma alanı
    const files2 = {};
    const shaOf = new Map(r.done.map((d) => [d.path, d.sha]));
    for (const f of eligible) {
      const s = snaps[f.path] || { size: f.size, mtime: f.mtime };
      files2[f.path] = { sha: shaOf.get(f.path) || null, size: s.size, mtime: s.mtime };
    }
    WS.saveState(gh, { head: r.commit, files: files2, words, full: true, lastPush: Date.now(), lastPull: null });
    return { project: gh, tooBig };
  });
}

// Google Drive: DraftRewind/<ad> klasörü → tüm dosyalar (alt klasörler dahil) yüklenir → doğrulanır.
// Başarılıysa ve atlanan büyük dosya yoksa yerel klasör kaldırılır (artık Drive projesi). onProgress(i, n)
// Dönen: { folder, tooBig, keptLocal }
export function moveToDrive(drive, p, onProgress) {
  return exclusive(p, async () => {
    await doSnapshot(p).catch(() => null);
    const { eligible, tooBig } = cloudCandidates(p);
    const before = {};
    for (const f of eligible) before[f.path] = { size: f.size, mtime: f.mtime };
    const folder = await drive.createProject(p.name);
    const dirIds = { '': folder.id };
    const dirId = async (dir) => {
      if (dirIds[dir]) return dirIds[dir];
      const slash = dir.lastIndexOf('/');
      const parent = await dirId(slash >= 0 ? dir.slice(0, slash) : '');
      const made = await drive.createFolder(slash >= 0 ? dir.slice(slash + 1) : dir, parent);
      dirIds[dir] = made.id;
      return made.id;
    };
    const got = [];
    for (let i = 0; i < eligible.length; i++) {
      const f = eligible[i];
      if (onProgress) onProgress(i, eligible.length);
      const slash = f.path.lastIndexOf('/');
      const parent = await dirId(slash >= 0 ? f.path.slice(0, slash) : '');
      const bytes = await workFile(p, f.path).bytes();
      const name = f.path.slice(slash + 1);
      const res = await drive.upload(parent, name, bytes, fileType(name).mimeType);
      got.push({ path: f.path, size: res && res.size != null ? Number(res.size) : bytes.length });
    }
    const v = Core.verifyCopy(eligible, got);
    if (!v.ok) throw userError('verify', 'move.verifyFailed');
    // Yüklerken değişen dosya varsa yerel klasör silinmez (yeni hali kaybolmasın)
    let changed = false;
    for (const f of eligible) {
      const s = statFile(workFile(p, f.path));
      if (!s || s.size !== before[f.path].size || s.mtime !== before[f.path].mtime) changed = true;
    }
    const keptLocal = !!tooBig.length || changed || cloudCandidates(p).eligible.length !== eligible.length;
    if (!keptLocal) {
      safeDelete(projectDir(p));
      safeDelete(stateFile(p));
      // Yerel sürüm kopyaları (ws-history) cihazda kalır
    }
    return { folder, tooBig, keptLocal };
  });
}
