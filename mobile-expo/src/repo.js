// GitHub projeleri ve telefonun git motoru (aşama 1b). Her proje bu cihazda tam bir git deposudur:
// geçmiş, eski sürümler ve "neler değişti" internetsiz çalışır; GitHub yalnızca uzak depodur.
// Çalışma klasörü yine Belgeler/Projeler/<proje> (Dosyalar'da görünür, Word yerinde açar);
// git verisi Library/Application Support/DraftRewind/git/<anahtar> (Dosyalar'da görünmez).
//
// syncProject() eski çalışma alanı modülünün (workspace.js) sonuç biçimini döndürür; ekranlar aynı kalır.
// Eski çalışma alanından geçiş: ilk eşitlemede ws-state'teki "hangi dosya hangi uzak halden indi" bilgisi
// motora verilir (baseFiles) — düzenlenmemiş eski kopyalar güncellenir, telefonda düzenlenenler korunur.
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { openProject, backendExpo, ensureGitRoot, uriToPath, defaultT } from './git';
import * as WS from './workspace';
import { safeName, uniqueName, readBytes, PHONE_FOLDER } from './files';
import { t } from './i18n';
import { mirror } from './git/mirror';
import { historyStore, driveRemote } from './driveSync';

const opened = new Map(); // anahtar → Promise<GitProject>

export const repoKey = (p) => (p.kind === 'drive' ? `drive-${safeName(p.repo)}` : `gh-${safeName(p.owner)}__${safeName(p.repo)}`);

// Drive klasörü → proje nesnesi (ekranlar GitHub projesiyle aynı alanları kullanır; owner 'drive', repo klasör kimliği)
export function driveProject(folder, index = 0) {
  const p = { kind: 'drive', owner: 'drive', repo: folder.id, driveId: folder.id, name: folder.name, branch: 'main', pushedAt: folder.modified || 0, index };
  // Klasör adı: daha önce seçilmişse o; bu adda başka bir projenin klasörü varsa "<ad> (Drive)"
  const st = WS.loadState(p);
  if (st.folder) return { ...p, folder: st.folder };
  const chosen = WS.projectDir(p).exists ? { ...p, folder: `${safeName(folder.name)} (Drive)` } : p;
  WS.saveState(chosen, st); // seçim kalıcı (klasör adı bundan sonra değişmez)
  return chosen;
}

// Bu cihazın kalıcı kimliği (paylaşılan geçmiş deposunda heads/<kimlik>.json)
export function deviceId() {
  const flags = WS.loadFlags();
  if (flags.deviceId) return flags.deviceId;
  const id = `tel-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  WS.saveFlags({ ...flags, deviceId: id });
  return id;
}
const remoteUrl = (p) => `https://github.com/${p.owner}/${p.repo}.git`;

// Uygulama dilindeki metinler; eksik anahtar varsa motorun Türkçe varsayılanı
const T = (key, vars) => {
  const s = t(key, vars);
  return s && s !== key ? s : defaultT(key, vars);
};

const author = () => ({ name: Platform.isPad ? 'iPad' : 'iPhone', email: 'telefon@draftrewind.local' });

export function repoFor(p) {
  const key = WS.loadState(p).gitKey || repoKey(p);
  let job = opened.get(key);
  if (!job) {
    job = (async () => {
      const dir = WS.ensureProjectDir(p);
      return openProject({ backend: backendExpo(), gitdir: `${ensureGitRoot()}/${key}`, dir: uriToPath(dir.uri), id: key, name: p.name, author: author(), t: T });
    })();
    job.catch(() => opened.delete(key));
    opened.set(key, job);
  }
  return job;
}

// Bu cihazda bu projenin bir kopyası var mı (git deposu ya da eski çalışma alanı)?
export function hasLocal(p) {
  const st = WS.loadState(p);
  return !!(st.engine || st.full || Object.keys(st.files || {}).length || WS.projectDir(p).exists);
}

// Silinmiş depo mu? (uzak boş göründüğünde sorulur)
async function repoExists(token, p) {
  try {
    const res = await fetch(`https://api.github.com/repos/${p.owner}/${p.repo}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (res.status === 404) return false;
    return true;
  } catch (e) {
    return true;
  }
}

function authError(e) {
  const err = new Error(t('err.sessionExpired'));
  err.auth = true;
  err.cause = e;
  return err;
}

// İki kayıt arasında farklı olan dosya yolları
async function diffPaths(r, fromOid, toOid) {
  if (fromOid === toOid) return [];
  const a = await r.treeFiles(fromOid || null);
  const b = await r.treeFiles(toOid || null);
  const out = [];
  for (const [rel, oid] of b) if (a.get(rel) !== oid) out.push(rel);
  for (const rel of a.keys()) if (!b.has(rel)) out.push(rel);
  return out;
}

// Gönderilmeyi bekleyen dosya sayısı (uzakta olmayan yerel kayıtlardaki değişiklikler)
async function pendingPaths(r) {
  const head = await r.head();
  if (!head) return [];
  return diffPaths(r, await r.remoteHead(), head);
}

const stripCopy = (copy) => copy.replace(/ \(diğer cihazdan\)(?=\.[^./]*$|$)/, '');

// Tam eşitleme. opts: { auto (gönder), manual }. Dönen (workspace.js ile aynı):
// { pull: { updated: [path], conflicts: [{ path, copy }], removed: [], skipped: [], moved }, pullError,
//   push: { pushed: [path], removed: [path], skipped, commit } | null, pending: { n, skipped } | null }
const inflight = new Map();
const lastSync = new Map(); // anahtar → zaman (ms)
const RECENT_MS = 15000;
export function syncProject(token, p, opts = {}) {
  const key = repoKey(p);
  // Az önce eşitlendi (ör. ana ekran → proje ekranı): kendiliğinden tekrar etme
  if (!opts.manual && !inflight.get(key) && Date.now() - (lastSync.get(key) || 0) < RECENT_MS) {
    const st = status(p);
    return Promise.resolve({ pull: { updated: [], conflicts: [], removed: [], skipped: [], moved: false }, pullError: null, push: null, pending: { n: st.pending, skipped: [] }, recent: true });
  }
  const running = inflight.get(key);
  if (running && !opts.manual) return running;
  const start = running ? running.catch(() => {}).then(() => doSync(token, p, opts)) : doSync(token, p, opts);
  const t0 = Date.now();
  const job = start
    .then((r) => {
      lastSync.set(key, Date.now());
      timing(p, 'sync', Date.now() - t0);
      return r;
    })
    .finally(() => {
      if (inflight.get(key) === job) inflight.delete(key);
    });
  inflight.set(key, job);
  return job;
}

// Son ölçülen süreler (Ayarlar › Gelişmiş › Senkron motoru testi raporunda görünür)
const timings = new Map();
function timing(p, what, ms) {
  const row = timings.get(p.name) || {};
  row[what] = ms;
  timings.set(p.name, row);
}
export function timingsReport() {
  return [...timings].map(([name, r]) => `SÜRE ${name}: ${Object.entries(r).map(([k, v]) => `${k} ${v} ms`).join(', ')}`);
}

async function doSync(token, p, opts) {
  if (p.kind === 'drive') return doDriveSync(token, p, opts);
  const r = await repoFor(p);
  const st = WS.loadState(p);
  const push = opts.auto !== false;
  const common = { remoteUrl: remoteUrl(p), token, repoExists: () => repoExists(token, p), pushedOid: st.pushedOid || null };
  const out = { pull: { updated: [], conflicts: [], removed: [], skipped: [], moved: false }, pullError: null, push: null, pending: null };
  const startHead = await r.head();
  const startRemote = await r.remoteHead();
  let pulled = 0;
  let conflicts = [];
  let res;
  try {
    if (!startHead) {
      // İlk kez: önce yalnızca al (eski çalışma alanındaki indirme kaydıyla), sonra kendi değişikliklerimiz
      const baseFiles = {};
      for (const [path, f] of Object.entries(st.files || {})) if (f && f.sha) baseFiles[path.normalize('NFC')] = f.sha;
      const first = await r.sync({ ...common, noPush: true, baseFiles });
      pulled += first.pulled;
      conflicts = conflicts.concat(first.conflicts);
    }
    const before = await r.head();
    res = await r.syncWithSnapshot({ ...common, snapshot: { kind: 'auto' }, noPush: !push });
    pulled += res.pulled;
    conflicts = conflicts.concat(res.conflicts);
    if (res.pushed) {
      const sent = await diffPaths(r, startRemote, res.head);
      const tree = await r.treeFiles(res.head);
      out.push = { pushed: sent.filter((x) => tree.has(x)), removed: sent.filter((x) => !tree.has(x)), skipped: r.skipped || [], commit: res.head };
    } else {
      const waiting = await pendingPaths(r);
      out.pending = { n: waiting.length, skipped: r.skipped || [] };
    }
    out.pull.moved = pulled > 0 || (await r.remoteHead()) !== startRemote || before !== res.head;
  } catch (e) {
    if (e && e.code === 'EGHAUTH') throw authError(e);
    throw e;
  }
  out.pull.updated = Array.from({ length: pulled }, () => '');
  out.pull.conflicts = conflicts.map((copy) => ({ path: stripCopy(copy), copy }));
  const files = await r.treeFiles(res.head);
  WS.saveState(p, {
    ...WS.loadState(p),
    engine: true,
    pushedOid: res.ahead ? st.pushedOid || null : res.head,
    lastPush: res.pushed ? res.at : st.lastPush,
    lastPull: pulled ? res.at : st.lastPull,
    count: files.size,
    pendingN: out.pending ? out.pending.n : 0,
  });
  return out;
}

// Ekrandaki durum satırı: hemen (kayıtlı durumdan). Eşitlemeden sonra güncellenir.
export function status(p) {
  const st = WS.loadState(p);
  if (!st.engine) return { count: Object.keys(st.files || {}).length, lastPush: st.lastPush, lastPull: st.lastPull, pending: 0 };
  return { count: st.count || 0, lastPush: st.lastPush, lastPull: st.lastPull, pending: st.pendingN || 0 };
}

// ---------------------------------------------------------------- okuma
// Ekranın son hali (geçmiş + dosyalar): proje anında açılsın, sonra arka planda tazelensin.
// Bellekte ve Caches'te (silinirse yeniden okunur). Geçmiş yalnızca yeni kayıtlar kadar okunur.
const views = new Map();
const viewFile = (p) => new File(new Directory(Paths.cache, 'dr-view'), `${repoKey(p)}.json`);

export function cachedView(p) {
  const key = repoKey(p);
  if (views.has(key)) return views.get(key);
  try {
    const f = viewFile(p);
    if (!f.exists) return null;
    const v = JSON.parse(f.textSync());
    if (v && Array.isArray(v.history) && Array.isArray(v.files)) {
      views.set(key, v);
      return v;
    }
  } catch (e) {}
  return null;
}

function saveView(p, patch) {
  const key = repoKey(p);
  const v = { history: [], files: [], ...(views.get(key) || {}), ...patch };
  views.set(key, v);
  try {
    const dir = new Directory(Paths.cache, 'dr-view');
    dir.create({ intermediates: true, idempotent: true });
    // Diskte yer tutmasın: kelime haritası yalnızca son kayıtlarda kalır (istatistik en yenisini kullanır)
    const slim = v.history.map((h, i) => (i < 5 ? h : { ...h, words: null }));
    viewFile(p).write(JSON.stringify({ ...v, history: slim }));
  } catch (e) {}
}

export async function history(p, limit = 1000) {
  const r = await repoFor(p);
  const t0 = Date.now();
  const v = views.get(repoKey(p)) || cachedView(p);
  const h = await r.history({ limit, known: v ? v.history : null });
  timing(p, 'history', Date.now() - t0);
  saveView(p, { history: h });
  return h;
}

// Klasördeki dosyalar → [{ path, size }]
export async function files(p) {
  const r = await repoFor(p);
  const t0 = Date.now();
  const { files: map } = await r.scan();
  const list = [...map].map(([path, f]) => ({ path, size: f.size }));
  timing(p, 'files', Date.now() - t0);
  saveView(p, { files: list });
  return list;
}

const toArrayBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// Bir dosyanın bir kayıttaki (ref yoksa klasördeki) hali → ArrayBuffer. Yoksa status 404 hatası.
export async function content(p, path, ref) {
  const r = await repoFor(p);
  const u8 = await r.readAt(ref || 'working', path);
  if (!u8) {
    const e = new Error(t('viewer.missing'));
    e.status = 404;
    throw e;
  }
  return toArrayBuffer(u8);
}

export async function commitFiles(p, oid) {
  const r = await repoFor(p);
  return r.commitFiles(oid);
}

// Word/Pages'in yerinde açacağı dosya
export const localFile = (p, path) => new File(WS.projectDir(p), ...path.split('/'));

// ---------------------------------------------------------------- telefondan ekleme
// Seçilen dosyalar "Telefondan eklenenler/" klasörüne yazılır ve TEK kayıt olur (gönderim eşitlemede).
// Önce bekleyen düzenlemeler kendi kaydına alınır ki "telefondan eklendi" kaydına karışmasın.
// onProgress(i). Dönen: { done: [ad], failed: [{ name, error }] }
export async function addFiles(p, assets, onProgress) {
  const r = await repoFor(p);
  await r.snapshot({ kind: 'auto' });
  const { files: map } = await r.scan();
  const taken = new Set([...map.keys()].map((x) => x.toLowerCase()));
  const done = [];
  const failed = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    if (onProgress) onProgress(i);
    try {
      const name = await uniqueName(safeName(a.name), async (candidate) => taken.has(`${PHONE_FOLDER}/${candidate}`.toLowerCase()));
      const path = `${PHONE_FOLDER}/${name}`;
      taken.add(path.toLowerCase());
      await r.writeWorking(path, await readBytes(a));
      done.push(name);
    } catch (e) {
      failed.push({ name: a.name, error: e });
    }
  }
  if (done.length) {
    const title = `${t('upload.fromPhone')}: ${done.length <= 2 ? done.join(', ') : t('upload.doneMany', { n: done.length })}`;
    await r.snapshot({ kind: 'mobile', title });
  }
  return { done, failed };
}

// Bu cihazda en az bir kayıt var mı (ilk indirme bitti mi)?
export async function ready(p) {
  const r = await repoFor(p);
  return !!(await r.head());
}

// ---------------------------------------------------------------- Drive projesi
// Sıra: (1) diğer cihazların kayıtları geçmişleriyle gelir → (2) bu cihazdaki düzenlemeler kayda girer →
// (3) Drive'daki dosyalarla eşitleme (Drive / Google Dokümanlar düzenlemeleri iner, bu cihazınkiler yüklenir) →
// (4) yeni kayıtlar diğer cihazlar için yayımlanır. auto false: yalnızca alınır, gönderilmez.
async function doDriveSync(drive, p, opts) {
  const r = await repoFor(p);
  const push = opts.auto !== false;
  const store = historyStore(drive, p.driveId);
  const dev = { store, deviceId: deviceId(), deviceName: author().name };
  const st = WS.loadState(p);
  const startRemote = st.pushedOid || null;
  const out = { pull: { updated: [], conflicts: [], removed: [], skipped: [], moved: false }, pullError: null, push: null, pending: null };
  const progress = opts.onProgress || null;
  const h1 = await r.syncStore({ ...dev, noPush: true, onProgress: progress });
  await r.snapshot({ kind: 'auto' });
  const mstate = st.mirror || {};
  const m = await mirror(r, driveRemote(drive, p.driveId), mstate, { upload: push, onProgress: progress });
  if (m.downloaded.length) {
    const names = [...new Set(m.downloaded.map((x) => x.split('/').pop()))];
    await r.snapshot({ kind: 'merge', title: t('ws.driveEdits', { names: names.slice(0, 3).join(', '), n: names.length, count: names.length }) });
  }
  const h2 = push ? await r.syncStore({ ...dev, onProgress: progress }) : { pushed: false, head: await r.head(), ahead: true };
  const pulled = h1.pulled + m.downloaded.length;
  out.pull.updated = Array.from({ length: pulled }, () => '');
  out.pull.conflicts = [...h1.conflicts, ...m.conflicts].map((copy) => ({ path: stripCopy(copy).replace(" (Drive'dan)", ''), copy }));
  out.pull.moved = pulled > 0;
  if (push && (m.uploaded.length || m.archived.length || h2.pushed)) {
    out.push = { pushed: m.uploaded, removed: m.archived, skipped: r.skipped || [], commit: h2.head };
  } else if (!push) {
    out.pending = { n: m.pending.length, skipped: r.skipped || [] };
  }
  const files = await r.treeFiles(await r.head());
  WS.saveState(p, {
    ...WS.loadState(p),
    engine: true,
    mirror: mstate,
    pushedOid: push ? h2.head : startRemote,
    lastPush: out.push ? Date.now() : st.lastPush,
    lastPull: pulled ? Date.now() : st.lastPull,
    count: files.size,
    pendingN: out.pending ? out.pending.n : 0,
  });
  return out;
}
