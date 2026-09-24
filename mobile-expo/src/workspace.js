// Yerel çalışma alanı: her proje için Belgeler/Projeler/<proje adı>/ klasörü (Dosyalar uygulamasında
// "DraftRewind" altında görünür). Word/Pages dosyayı bu klasörden yerinde açar; kaydedilen her hali
// GitHub'a tek kayıt olarak gönderilir, bilgisayarda değişenler de buraya iner.
// Durum dosyası (hangi yol hangi blob sha/boyut/mtime ile indi) klasörün dışında tutulur:
// Belgeler/ws-state/<sahip>__<depo>.json — Word gizli dosyalara takılmasın, kullanıcı da görmesin.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as GH from './github';
import { MAX_UPLOAD, safeName, uniqueName } from './files';
import { latestWords } from './stats';
import { t } from './i18n';
import { countWords, countsWords, classifyChanges, decideRemoteChange, conflictName, advanceWords, buildMessage, ignoredName, isLocallyModified, recentlyTouched } from './wsCore';

export const ROOT_FOLDER = 'Projeler';
const root = () => new Directory(Paths.document, ROOT_FOLDER);
const stateDir = () => new Directory(Paths.document, 'ws-state');
export const folderName = (p) => safeName(p.name);
export const projectDir = (p) => new Directory(root(), folderName(p));
const stateFile = (p) => new File(stateDir(), `${safeName(p.owner)}__${safeName(p.repo)}.json`);

// Dosyalar uygulamasındaki yol (kullanıcıya gösterilen ipucu)
export const filesPath = (p) => `DraftRewind › ${ROOT_FOLDER} › ${folderName(p)}`;

const EMPTY = () => ({ head: null, files: {}, words: null, full: false, lastPush: null, lastPull: null });

export function loadState(p) {
  try {
    const f = stateFile(p);
    if (!f.exists) return EMPTY();
    const st = JSON.parse(f.textSync()) || {};
    return { ...EMPTY(), ...st, files: st.files && typeof st.files === 'object' ? st.files : {} };
  } catch (e) {
    return EMPTY();
  }
}

export function saveState(p, st) {
  try {
    stateDir().create({ intermediates: true, idempotent: true });
    stateFile(p).write(JSON.stringify(st));
  } catch (e) {}
}

// Genel bayraklar (ör. "Word ile düzenleme" ipucu bir kez gösterildi)
const flagsFile = () => new File(stateDir(), 'flags.json');
export function loadFlags() {
  try {
    const f = flagsFile();
    return f.exists ? JSON.parse(f.textSync()) || {} : {};
  } catch (e) {
    return {};
  }
}
export function saveFlags(flags) {
  try {
    stateDir().create({ intermediates: true, idempotent: true });
    flagsFile().write(JSON.stringify(flags));
  } catch (e) {}
}

export function ensureProjectDir(p) {
  const d = projectDir(p);
  d.create({ intermediates: true, idempotent: true });
  return d;
}

export const localFile = (p, path) => new File(projectDir(p), ...path.split('/'));

// { size, mtime } ya da dosya yoksa/okunamıyorsa null
function statLocal(file) {
  try {
    if (!file.exists) return null;
    return { size: file.size, mtime: file.modificationTime || 0 };
  } catch (e) {
    return null;
  }
}

// Dosyayı olabildiğince atomik yazar: önce aynı klasörde geçici dosya, sonra hedefin üstüne taşınır
// (Word yarım yazılmış bir dosya görmesin). Taşıma olmazsa doğrudan yazılır.
function writeLocal(p, path, bytes) {
  const segs = path.split('/');
  const dir = segs.length > 1 ? new Directory(projectDir(p), ...segs.slice(0, -1)) : projectDir(p);
  dir.create({ intermediates: true, idempotent: true });
  const f = new File(dir, segs[segs.length - 1]);
  const tmp = new File(dir, `.dr-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
  try {
    tmp.write(bytes);
    try {
      tmp.moveSync(f, { overwrite: true });
    } catch (e) {
      if (f.exists) f.delete();
      tmp.moveSync(f);
    }
  } catch (e) {
    try {
      if (tmp.exists) tmp.delete();
    } catch (e2) {}
    f.write(bytes);
  }
  return f;
}

// snapshot verilirse (okuma anındaki boyut/mtime) o yazılır: yükleme sürerken yapılan bir kayıt
// sonraki taramada "değişmiş" görünsün
function track(st, path, file, sha, snapshot) {
  const s = snapshot || statLocal(file);
  st.files[path] = { sha: sha || null, size: s ? s.size : 0, mtime: s ? s.mtime : Date.now() };
}

// Ekrandaki durum satırı için: bu cihazdaki dosya sayısı, son gönderim
export function status(p) {
  const st = loadState(p);
  return { count: Object.keys(st.files).length, lastPush: st.lastPush, lastPull: st.lastPull, full: !!st.full };
}

// Bir dosyanın en yeni halini çalışma alanına indirir ve izlemeye alır
export async function downloadFile(token, p, path, sha) {
  const bytes = new Uint8Array(await GH.fileContent(token, p, path));
  const st = loadState(p);
  const f = writeLocal(p, path, bytes);
  track(st, path, f, sha || null);
  saveState(p, st);
  return f;
}

// Düzenleme için yerel kopya: yerelde (izlenen ya da kullanıcının koyduğu) bir hali varsa ona dokunulmaz,
// yoksa indirilir. Kullanıcının düzenlemesi asla üzerine yazılmaz.
export async function ensureLocal(token, p, file) {
  const f = localFile(p, file.path);
  const st = loadState(p);
  const entry = st.files[file.path];
  const local = statLocal(f);
  if (local && (!entry || isLocallyModified(entry, local) || entry.sha === file.sha)) return f;
  return downloadFile(token, p, file.path, file.sha);
}

function walk(dir, prefix, out, unreadable) {
  let items;
  try {
    items = dir.list();
  } catch (e) {
    return;
  }
  for (const it of items) {
    const name = it.name;
    if (!name || ignoredName(name)) continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (it instanceof Directory) walk(it, rel, out, unreadable);
    else {
      const s = statLocal(it);
      if (s) out[rel] = s;
      else unreadable.push(rel);
    }
  }
}

// Klasörü tarar: durum dosyasına göre değişen / yeni (kullanıcının koyduğu) / silinen yollar.
// skipped: gönderilemeyecekler ({ path, reason: 'tooBig' | 'unreadable' })
export function scanChanges(p) {
  const st = loadState(p);
  const dir = projectDir(p);
  const locals = {};
  const unreadable = [];
  if (dir.exists) walk(dir, '', locals, unreadable);
  // Okunamayanlar "silindi" sayılmaz (izleme kaydı korunur); classifyChanges onları atlanan olarak listeler
  const r = classifyChanges(st.files, locals, MAX_UPLOAD, unreadable);
  return { ...r, state: st };
}

const baseName = (path) => path.split('/').pop();

// Kayıt başlığı: "iPad'de düzenlendi: a.docx, b.docx" (+ silinenler)
export function pushTitle(uploaded, removed) {
  const names = (list) => (list.length <= 3 ? list.map(baseName).join(', ') : `${list.slice(0, 2).map(baseName).join(', ')} ${t('ws.moreFiles', { n: list.length - 2 })}`);
  const parts = [];
  if (uploaded.length) parts.push(names(uploaded));
  if (removed.length) parts.push(`${t('ws.deletedNames')} ${names(removed)}`);
  return `${t(Platform.isPad ? 'ws.editedIpad' : 'ws.editedPhone')}: ${parts.join(' · ')}`;
}

// Yerel değişiklikleri TEK kayıtta gönderir (yeni/değişen bloblar + silinenler), kelime sayılarıyla.
// opts.onProgress(i, n). Dönen: { pushed: [path], removed: [path], skipped: [{ path, reason }], commit }
export async function pushChanges(token, p, opts = {}) {
  const scan = scanChanges(p);
  const st = scan.state;
  const paths = [...scan.modified, ...scan.added];
  const skipped = [...scan.skipped];
  if (!paths.length && !scan.deleted.length) return { pushed: [], removed: [], skipped, commit: null };

  // Kelime haritası: durum dosyasından; ilk kez ise son kaydın "words" bilgisinden
  let prevWords = st.words;
  if (!prevWords) {
    try {
      prevWords = latestWords(await GH.listSnapshots(token, p, 1));
    } catch (e) {
      if (e && e.auth) throw e;
      prevWords = {};
    }
  }
  const counts = {};
  const snapshots = {};
  const files = paths.map((path) => ({
    path,
    read: async () => {
      const f = localFile(p, path);
      // Boyut/mtime okumadan ÖNCE alınır: yükleme sürerken Word kaydederse o hal sonraki turda gider
      snapshots[path] = statLocal(f);
      if (countsWords(path)) counts[path] = await countWords(path, await f.bytes());
      return f.base64();
    },
  }));
  let nextWords = prevWords;
  const r = await GH.commitChanges(
    token,
    p,
    files,
    scan.deleted,
    (uploaded, removed) => {
      const picked = {};
      for (const path of uploaded) if (counts[path] != null) picked[path] = counts[path];
      const { words, delta } = advanceWords(prevWords, picked, removed);
      nextWords = words;
      return buildMessage({ title: pushTitle(uploaded, removed), changed: uploaded, deleted: removed, words, delta });
    },
    (i) => opts.onProgress && opts.onProgress(i, files.length)
  );
  for (const f of r.failed) skipped.push({ path: f.path, reason: 'unreadable', error: f.error });
  // Durum: gönderilenler yeni sha/mtime ile izlenir; silinenler (uzakta zaten yoksa da) izlemeden çıkar
  for (const d of r.done) track(st, d.path, localFile(p, d.path), d.sha, snapshots[d.path]);
  for (const path of scan.deleted) delete st.files[path];
  if (r.commit) {
    st.head = r.commit;
    st.words = nextWords;
    st.lastPush = Date.now();
  }
  saveState(p, st);
  return { pushed: r.done.map((d) => d.path), removed: r.removed, skipped, commit: r.commit };
}

// Bilgisayardan gelen değişiklikleri indirir. Kural (masaüstüyle aynı): yerel dosya değişmemişse üzerine
// yazılır; yerel de değişmişse yerel kalır, uzaktaki hali "<ad> (diğer cihazdan).<uzantı>" olarak yanına konur.
// Yalnızca izlenen dosyalar (ya da proje tümüyle indirildiyse hepsi). opts.onProgress(i, n)
// Dönen: { updated: [path], conflicts: [{ path, copy }], removed: [path], skipped: [path], moved: bool }
export async function pullChanges(token, p, opts = {}) {
  const st = loadState(p);
  const out = { updated: [], conflicts: [], removed: [], skipped: [], moved: false };
  if (!Object.keys(st.files).length && !st.full) return out;
  const head = await GH.branchHead(token, p);
  if (!head || head === st.head) return out;
  out.moved = true;
  const remote = await GH.listFiles(token, p, head);
  const remoteMap = new Map(remote.map((f) => [f.path, f]));
  const jobs = remote.filter((f) => {
    const entry = st.files[f.path];
    if (!entry && !st.full) return false;
    if (entry && entry.sha === f.sha) return false;
    return true;
  });
  for (let i = 0; i < jobs.length; i++) {
    const f = jobs[i];
    if (opts.onProgress) opts.onProgress(i, jobs.length);
    const entry = st.files[f.path];
    const lf = localFile(p, f.path);
    const local = statLocal(lf);
    // Kullanıcının koyduğu, henüz izlenmeyen aynı adlı dosya da "yerelde değişmiş" sayılır
    const decision = !entry && local ? 'conflict' : decideRemoteChange(entry, local, f.sha);
    if (decision === 'skip') continue;
    if (f.size > MAX_UPLOAD) {
      out.skipped.push(f.path);
      continue;
    }
    // Son 60 sn içinde kaydedilmiş dosya Word'de açık olabilir: bu tura dokunma, sonraki eşitlemede alınır
    if (decision === 'download' && recentlyTouched(local)) {
      out.deferred = (out.deferred || 0) + 1;
      continue;
    }
    const bytes = new Uint8Array(await GH.fileContent(token, p, f.path, head));
    if (decision === 'download') {
      track(st, f.path, writeLocal(p, f.path, bytes), f.sha);
      out.updated.push(f.path);
    } else {
      const copy = conflictName(f.path);
      writeLocal(p, copy, bytes);
      // Yerel hali "değişmiş" kalmaya devam eder (mtime/boyut eski kayıttan), sonraki gönderimde gider
      st.files[f.path] = { sha: f.sha, size: entry ? entry.size : -1, mtime: entry ? entry.mtime : 0 };
      out.conflicts.push({ path: f.path, copy });
    }
    // Her dosyadan sonra kaydet: ortada kesilirse inenler "bu cihazda değişmiş" sanılmasın
    saveState(p, st);
  }
  // Uzakta artık olmayan izlenen dosyalar: yerel değişmemişse silinir, değişmişse korunur (yeni dosya olarak gider)
  for (const path of Object.keys(st.files)) {
    if (remoteMap.has(path)) continue;
    const lf = localFile(p, path);
    const local = statLocal(lf);
    if (local && isLocallyModified(st.files[path], local)) {
      delete st.files[path];
      continue;
    }
    try {
      if (lf.exists) lf.delete();
    } catch (e) {}
    delete st.files[path];
    out.removed.push(path);
  }
  saveState(p, st);
  // Ertelenen dosya varsa uç ilerletilmez: sonraki eşitleme onları yeniden dener
  if (!out.deferred) st.head = head;
  st.lastPull = Date.now();
  st.words = null; // bilgisayarın kelime haritası değişmiş olabilir; sonraki gönderimde yeniden okunur
  saveState(p, st);
  return out;
}

// Tam indirme: tüm dosyalar (50 MB üstü atlanır), sonrasında proje tam izlenir. Doğrudan değil,
// syncProject(…, { full: true }) üzerinden çağrılır ki aynı projede eşzamanlı iş olmasın.
async function pullAll(token, p, opts) {
  ensureProjectDir(p);
  const st = loadState(p);
  st.full = true;
  st.head = null; // her dosya uzaktaki haliyle karşılaştırılsın
  saveState(p, st);
  return pullChanges(token, p, opts);
}

// "Bu projeyi iPad'e/telefona indir" — sıradaki işle çakışmaz (aynı kuyruk)
export async function downloadProject(token, p, opts = {}) {
  const r = await syncProject(token, p, { ...opts, full: true, auto: false });
  if (r.pullError) throw r.pullError;
  return r.pull || { updated: [], conflicts: [], removed: [], skipped: [], moved: false };
}

// Tam eşitleme: önce bilgisayardan gelenler (yerel silinmişse uzaktaki yeni hal kaybolmasın), sonra
// yerel değişiklikler (auto false ise yalnızca sayılır). Aynı proje için aynı anda tek iş çalışır;
// elle başlatılan (manual) ya da tam indirme isteği sürmekte olan işin ARDINA eklenir, sonucu atlanmaz.
const inflight = new Map();
export function syncProject(token, p, opts = {}) {
  const key = `${p.owner}/${p.repo}`;
  const running = inflight.get(key);
  if (running && !opts.manual && !opts.full) return running;
  const start = running ? running.catch(() => {}).then(() => doSync(token, p, opts)) : doSync(token, p, opts);
  const job = start.finally(() => {
    if (inflight.get(key) === job) inflight.delete(key);
  });
  inflight.set(key, job);
  return job;
}

async function doSync(token, p, opts) {
  const out = { pull: null, pullError: null, push: null, pending: null };
  const st = loadState(p);
  if (!opts.full && !Object.keys(st.files).length && !st.full && !projectDir(p).exists) return out;
  try {
    out.pull = opts.full ? await pullAll(token, p, opts) : await pullChanges(token, p, opts);
  } catch (e) {
    if (e && e.auth) throw e;
    out.pullError = e;
  }
  const scan = scanChanges(p);
  const n = scan.modified.length + scan.added.length + scan.deleted.length;
  // İndirme yarıda kaldıysa gönderme yapılmaz: yarım durum "bu cihazda düzenlendi" kaydına dönüşmesin
  if (n && opts.auto !== false && !out.pullError) out.push = await pushChanges(token, p, opts);
  else out.pending = { n, skipped: scan.skipped };
  return out;
}

// Yerelde (izlenen dosyalar arasında) bu adla dosyası olan projeler → [{ project, path }]
export function findTracked(projects, name) {
  const hits = [];
  for (const p of projects) {
    const st = loadState(p);
    for (const path of Object.keys(st.files)) if (baseName(path) === name) hits.push({ project: p, path });
  }
  return hits;
}

// "DraftRewind'da aç" ile gelen dosyayı projeye kopyalar. targetPath verilmişse o yola (izlenen dosya),
// yoksa proje köküne. Gönderilmemiş yerel değişikliği olan bir dosyanın üzerine yazılmaz: "(2)" adıyla konur.
// Dönen: hedef yol. Okunamazsa { unreadable: true } hatası fırlatır.
export async function importIncoming(p, srcUri, name, targetPath) {
  ensureProjectDir(p);
  // Dosya zaten bu projenin klasöründeyse (Dosyalar'dan "DraftRewind'da aç") kopyalamaya gerek yok
  const inside = insideProject(p, srcUri);
  if (inside != null) return inside;
  const st = loadState(p);
  let path = targetPath || safeName(name);
  const entry = st.files[path];
  const local = statLocal(localFile(p, path));
  if (local && (!entry || isLocallyModified(entry, local))) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const unique = await uniqueName(baseName(path), async (candidate) => localFile(p, dir + candidate).exists);
    path = dir + unique;
  }
  const src = new File(srcUri);
  let bytes;
  try {
    bytes = await src.bytes();
  } catch (e) {
    const err = new Error(t('ws.incomingUnreadable'));
    err.unreadable = true;
    throw err;
  }
  writeLocal(p, path, bytes);
  // iOS "Şununla aç" kopyasını Belgeler/Inbox'a koyar; silinmezse bir sonraki aynı ad "Ad-1.docx" olur
  if (isInboxUri(srcUri)) {
    try {
      src.delete();
    } catch (e) {}
  }
  return path;
}

// Aynı adı taşıyan ama yüzde-kodlaması farklı iki file:// yolu karşılaştırılabilsin
const normUri = (uri) => {
  try {
    return decodeURIComponent(String(uri)).replace(/^file:\/+/i, '/').replace(/\/+$/, '');
  } catch (e) {
    return String(uri).replace(/^file:\/+/i, '/').replace(/\/+$/, '');
  }
};

// uri projenin klasöründeyse göreli yolu (ör. "Bölüm/Giriş.docx"), değilse null
export function insideProject(p, uri) {
  const root = normUri(projectDir(p).uri) + '/';
  const u = normUri(uri);
  return u.startsWith(root) ? u.slice(root.length) : null;
}

export const isInboxUri = (uri) => normUri(uri).startsWith(normUri(Paths.document.uri) + '/Inbox/');
