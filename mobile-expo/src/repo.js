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
import { historyStore, driveRemote, readTombstones, addTombstone } from './driveSync';
import * as GH from './github';
import * as LOCAL from './local';
import * as TRASH from './trash';

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

export const gitKeyOf = (p) => WS.loadState(p).gitKey || repoKey(p);

export function repoFor(p) {
  const key = gitKeyOf(p);
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

// Ana ekran: proje bu cihaza inmiş mi? (bağlantısı kesilmiş giriş sayılmaz)
export function onDevice(p) {
  const st = WS.loadState(p);
  if (st.detached) return false;
  return !!(st.engine || st.full || Object.keys(st.files || {}).length) && WS.projectDir(p).exists;
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
  const key = gitKeyOf(p);
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

// Tüm bağlantılar sırayla: önce GitHub, sonra Drive (Drive'a GitHub'dan gelenler de yansır).
// Girişin kendi bağlantısının hatası fırlatılır; diğer bağlantının hatası pullError olarak döner.
async function doSync(token, p, opts) {
  const conns = connectionsOf(p);
  const ghToken = p.kind === 'drive' ? auth.github : token || auth.github;
  const drive = p.kind === 'drive' ? token || auth.drive : auth.drive;
  const jobs = [];
  if (conns.github && ghToken) jobs.push({ self: p.kind !== 'drive', run: () => doGithubSync(ghToken, conns.github, opts) });
  if (conns.drive && drive) jobs.push({ self: p.kind === 'drive', run: () => doDriveSync(drive, conns.drive, opts) });
  const out = { pull: { updated: [], conflicts: [], removed: [], skipped: [], moved: false }, pullError: null, push: null, pending: null };
  for (const job of jobs) {
    let r;
    try {
      r = await job.run();
    } catch (e) {
      if (job.self) throw e;
      out.pullError = e;
      continue;
    }
    out.pull.updated.push(...r.pull.updated);
    out.pull.conflicts.push(...r.pull.conflicts);
    out.pull.moved = out.pull.moved || r.pull.moved;
    if (r.push) {
      const prev = out.push || { pushed: [], removed: [], skipped: [], commit: null };
      out.push = { pushed: [...new Set([...prev.pushed, ...r.push.pushed])], removed: [...new Set([...prev.removed, ...r.push.removed])], skipped: r.push.skipped, commit: r.push.commit };
    }
    if (r.pending) out.pending = { n: Math.max(out.pending ? out.pending.n : 0, r.pending.n), skipped: r.pending.skipped };
  }
  return out;
}

async function doGithubSync(token, p, opts) {
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
    if (e && e.code === 'EGHREPO') {
      const err = new Error(t('err.ghRepoGone'));
      err.repoGone = true;
      throw err;
    }
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
  // Uç dosyasında projenin GitHub bağlantısı da yayımlanır: diğer cihazlar aynı depoya bağlanır
  const linkedGh = connectionsOf(p).github;
  const dev = { store, deviceId: deviceId(), deviceName: author().name, meta: { github: linkedGh ? { owner: linkedGh.owner, repo: linkedGh.repo } : null, roots: await r.roots() } };
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
  const peers = [...(h2.peers || []), ...(h1.peers || [])];
  adoptPeerGithub(p, peers);
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
    devices: dedupePeers(peers),
    pushedOid: push ? h2.head : startRemote,
    lastPush: out.push ? Date.now() : st.lastPush,
    lastPull: pulled ? Date.now() : st.lastPull,
    count: files.size,
    pendingN: out.pending ? out.pending.n : 0,
  });
  return out;
}

// ---------------------------------------------------------------- bağlantılar (aşama 3)
// Bir proje = bu cihazdaki tek git deposu + klasör. Her bulut bağlantısının ayrı bir "girişi" (durum dosyası)
// vardır; bağlı girişler gitKey ve klasörü paylaşır ve birbirini kaydeder (GitHub girişinde drive, Drive
// girişinde github). Ana ekran projeyi hangi listeden açarsa açsın aynı proje, aynı geçmiş.
const auth = { github: null, drive: null };
export function setAuth(next) {
  Object.assign(auth, next);
}
export const getAuth = () => ({ ...auth });

const ghEntry = (g) => ({ owner: g.owner, repo: g.repo, name: g.name, branch: 'main' });
const driveEntry = (d) => ({ kind: 'drive', owner: 'drive', repo: d.id, driveId: d.id, name: d.name, branch: 'main' });

// { github: giriş | null, drive: giriş | null }
export function connectionsOf(p) {
  const st = WS.loadState(p);
  if (p.kind === 'drive') return { drive: p, github: st.github ? ghEntry(st.github) : null };
  return { github: p, drive: st.drive ? driveEntry(st.drive) : null };
}

async function link(p) {
  const r = await repoFor(p);
  const key = r.id;
  const folder = WS.folderName(p);
  const st = WS.loadState(p);
  WS.saveState(p, { ...st, gitKey: key, folder });
  return { key, folder };
}

// Drive bağlantısı ekle: Drive'da klasör açılır; ilk eşitlemede tüm geçmiş ve dosyalar yüklenir
export async function connectDrive(p, drive, given = null) {
  const { key, folder } = await link(p);
  // Verilen klasör; yoksa Drive'da bu projenin klasörü (ör. bilgisayar zaten eşitliyor); o da yoksa yeni klasör
  const f = given || (await findDriveFolder(p, drive)) || (await drive.createProject(p.name));
  WS.saveState(driveEntry({ id: f.id, name: f.name }), { head: null, files: {}, engine: true, gitKey: key, folder, github: { owner: p.owner, repo: p.repo, name: p.name } });
  WS.saveState(p, { ...WS.loadState(p), drive: { id: f.id, name: f.name } });
  return f;
}

// Aynı projenin Drive klasörü: adı aynı (ya da "Ad (2)" gibi) ve .draftrewind uç dosyalarından biri ya bu
// GitHub deposunu yazıyor ya da bu cihazdaki geçmişte bulunan bir kayda işaret ediyor
async function findDriveFolder(p, drive) {
  const r = await repoFor(p);
  const norm = (n) => String(n).trim().toLocaleLowerCase('tr-TR');
  const base = norm(p.name);
  const sameName = (n) => {
    const x = norm(n);
    if (x === base) return true;
    const rest = x.startsWith(base + ' (') ? x.slice(base.length + 2) : '';
    return /^\d+\)$/.test(rest);
  };
  let folders = [];
  try {
    folders = (await drive.projects()).filter((x) => sameName(x.name));
  } catch (e) {
    return null;
  }
  for (const folder of folders) {
    try {
      const store = historyStore(drive, folder.id);
      for (const n of (await store.list()).filter((x) => x.startsWith('heads/'))) {
        const h = JSON.parse(new TextDecoder().decode(await store.read(n)));
        if (h && h.github && h.github.owner === p.owner && h.github.repo === p.repo) return folder;
        if (h && /^[0-9a-f]{40}$/.test(h.head) && (await r.hasCommit(h.head))) return folder;
      }
    } catch (e) {}
  }
  return null;
}

// GitHub bağlantısı ekle: boş depo açılır; ilk eşitlemede tüm geçmiş gönderilir
export async function connectGithub(p, token) {
  const { key, folder } = await link(p);
  const gh = await GH.createProject(token, p.name, null);
  WS.saveState(ghEntry(gh), { head: null, files: {}, full: true, engine: true, gitKey: key, folder, drive: { id: p.driveId, name: p.name } });
  WS.saveState(p, { ...WS.loadState(p), github: { owner: gh.owner, repo: gh.repo, name: gh.name } });
  return gh;
}

// Bağlantıyı kes: eşitleme durur, buluttaki kopyaya dokunulmaz. which: 'github' | 'drive'
export function disconnect(p, which) {
  const conns = connectionsOf(p);
  const gone = conns[which];
  if (!gone) return;
  const keep = which === 'github' ? conns.drive : conns.github;
  if (keep) {
    const st = WS.loadState(keep);
    delete st[which];
    WS.saveState(keep, st);
  }
  detach(gone, which);
}

// Kesilen giriş: ana ekrandan yeniden açılırsa bu projeye değil, ayrı bir klasöre ve ayrı bir kopyaya iner
function detach(entry, which) {
  const folder = `${WS.folderName(entry)} (${which === 'github' ? 'GitHub' : 'Drive'})`;
  // Ayrı klasör ve ayrı geçmiş deposu: bu projenin deposuyla asla karışmaz
  WS.saveState(entry, { head: null, files: {}, detached: true, folder, gitKey: `${repoKey(entry)}-${Date.now().toString(36)}` });
}

// Son bağlantı da kapandı: proje bu cihazda, geçmişiyle birlikte hesapsız proje olarak sürer
export function keepLocalOnly(p) {
  const conns = connectionsOf(p);
  const key = gitKeyOf(p);
  const folder = WS.folderName(p);
  if (conns.github) detach(conns.github, 'github');
  if (conns.drive) detach(conns.drive, 'drive');
  LOCAL.adoptAsLocal({ folder, name: p.name, gitKey: key });
  opened.delete(key);
}

// Bu oturumda silinen bulut projeleri: GitHub/Drive listesi birkaç saniye geç güncellenir, o sürede gizlenir
const removed = new Set();
export const isRemoved = (entry) => removed.has(entry.driveId ? `drive:${entry.driveId}` : `gh:${entry.owner}/${entry.repo}`);
const markRemoved = (entry) => removed.add(entry.driveId ? `drive:${entry.driveId}` : `gh:${entry.owner}/${entry.repo}`);

// Buluttaki kopyayı sil (bağlantı kesildikten sonra çağrılır). GitHub izni yoksa { settingsUrl } döner.
export async function deleteRemote(which, entry, { token, drive } = {}) {
  if (which === 'drive') {
    try {
      await drive.req('PATCH', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(entry.driveId)}?fields=id`, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch (e) {
      // 403/404: klasörü bu uygulama oluşturmamış (ör. bilgisayardaki Google Drive klasörü) → Drive'da açılır
      if (e && (e.status === 403 || e.status === 404)) return { done: false, openUrl: `https://drive.google.com/drive/folders/${entry.driveId}` };
      throw e;
    }
    markRemoved(entry);
    return { done: true };
  }
  const res = await fetch(`https://api.github.com/repos/${entry.owner}/${entry.repo}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 204 || res.status === 404) {
    markRemoved(entry);
    return { done: true };
  }
  return { done: false, settingsUrl: `https://github.com/${entry.owner}/${entry.repo}/settings` };
}

// Başka bir cihaz bu projeyi GitHub'a bağlamışsa (uç dosyasında github) bu cihaz da aynı depoya bağlanır;
// yalnızca bu cihazda o depo için ayrı bir proje yoksa (iki ayrı geçmiş karışmasın)
function adoptPeerGithub(p, peers) {
  if (connectionsOf(p).github) return;
  const g = peers.map((x) => x && x.github).find((x) => x && x.owner && x.repo);
  if (!g) return;
  const entry = ghEntry({ owner: g.owner, repo: g.repo, name: p.name });
  if (WS.loadState(entry).engine) return;
  WS.saveState(entry, { head: null, files: {}, full: true, engine: true, gitKey: gitKeyOf(p), folder: WS.folderName(p), drive: { id: p.driveId, name: p.name } });
  WS.saveState(p, { ...WS.loadState(p), github: { owner: g.owner, repo: g.repo, name: p.name } });
}

// ---------------------------------------------------------------- aynı projeyi tanıma
// Drive klasöründeki projenin kimliği: uç dosyalarındaki kök kayıtlar, uçlar ve GitHub bağlantısı (yalnızca okunur)
export async function peekDriveFolder(drive, folderId) {
  const store = historyStore(drive, folderId);
  const out = { roots: new Set(), heads: [], github: null };
  for (const n of (await store.list()).filter((x) => x.startsWith('heads/'))) {
    try {
      const h = JSON.parse(new TextDecoder().decode(await store.read(n)));
      if (h && Array.isArray(h.roots)) h.roots.forEach((x) => out.roots.add(x));
      if (h && /^[0-9a-f]{40}$/.test(h.head)) out.heads.push(h.head);
      if (h && h.github && h.github.owner && !out.github) out.github = h.github;
    } catch (e) {}
  }
  return out;
}

// Bu cihazdaki projelerden hangisi o klasörün projesi? candidates: [{ kind: 'gh' | 'drive' | 'local', project }]
// Kimlik: aynı GitHub deposu, ortak kök kayıt ya da klasörün uçlarından biri bu cihazın geçmişinde.
export async function matchOnDevice(info, candidates) {
  for (const c of candidates) {
    try {
      if (info.github && c.kind === 'gh' && info.github.owner === c.project.owner && info.github.repo === c.project.repo) return c;
      const r = c.kind === 'local' ? await LOCAL.engineOf(c.project) : await repoFor(c.project);
      const roots = await r.roots();
      if (roots.some((x) => info.roots.has(x))) return c;
      for (const head of info.heads) if (await r.hasCommit(head)) return c;
    } catch (e) {}
  }
  return null;
}

// ---------------------------------------------------------------- bu cihazdan kaldırma
// Klasör ve git geçmişi Silinenler'e (30 gün); bağlantı girişleri silinir → proje "Bulutunda"ya döner.
// Buluttaki kopyalara dokunulmaz. Geri yüklemede girişler aynen yazılır (bağlantılar geri gelir).
export function removeFromDevice(p, { tomb } = {}) {
  const conns = connectionsOf(p);
  const key = gitKeyOf(p);
  const entries = [conns.github, conns.drive].filter(Boolean);
  const states = entries.map((e) => ({ entry: e.driveId ? { kind: 'drive', owner: 'drive', repo: e.driveId, driveId: e.driveId, name: e.name } : { owner: e.owner, repo: e.repo, name: e.name }, state: WS.loadState(e) }));
  const id = TRASH.moveToTrash({ name: p.name, files: WS.projectDir(p), gitKey: key, meta: { kind: 'cloud', folder: WS.folderName(p), states, tomb: tomb || null } });
  for (const e of entries) {
    WS.removeState(e);
    views.delete(repoKey(e));
  }
  opened.delete(key);
  return id;
}

export function restoreFromTrash(item) {
  ignoreTomb(item.tomb);
  if (item.kind === 'local') return LOCAL.restoreFromTrash(item);
  const folder = WS.uniqueFolder(item.folder || item.name);
  const { gitKey } = TRASH.takeOut(item.id, { files: WS.projectDir({ name: folder, folder }) });
  for (const { entry, state } of item.states || []) WS.saveState(entry, { ...state, folder, gitKey });
  return { name: item.name };
}

// ---------------------------------------------------------------- her yerden sil
// Buluttaki kopyalar silinir (Drive klasörü çöpe, GitHub deposu silinir), Drive'a "silindi" kaydı bırakılır
// (diğer cihazlar kendi kopyalarını kaldırsın), sonra bu cihazdaki kopya Silinenler'e (30 gün).
// Dönen: { notes: [{ settingsUrl } | { openUrl }] } — izin vermeyen bulutlar için kullanıcıya yol
export async function deleteEverywhere(p) {
  const conns = connectionsOf(p);
  const r = await repoFor(p);
  const roots = await r.roots();
  const notes = [];
  if (auth.drive && roots.length) {
    try {
      await addTombstone(auth.drive, { id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, roots, name: p.name, at: Date.now(), device: author().name });
    } catch (e) {}
  }
  if (conns.drive && auth.drive) {
    const res = await deleteRemote('drive', conns.drive, { drive: auth.drive });
    if (!res.done) notes.push(res);
  }
  if (conns.github && auth.github) {
    const res = await deleteRemote('github', conns.github, { token: auth.github });
    if (!res.done) notes.push(res);
  }
  removeFromDevice(p);
  return { notes };
}

// Başka cihazda "her yerden silinen" projeler: bu cihazdaki kopyası Silinenler'e (30 gün, geri yüklenebilir).
// candidates: [{ kind: 'gh' | 'drive' | 'local', project }]. Geri yüklenen projenin kaydı bir daha uygulanmaz.
// Dönen: kaldırılan proje adları
export async function applyTombstones(drive, candidates) {
  const { items } = await readTombstones(drive);
  if (!items.length) return [];
  const flags = WS.loadFlags();
  const ignore = new Set(flags.ignoredTombs || []);
  const fresh = items.filter((x) => x && x.id && !ignore.has(x.id) && Array.isArray(x.roots) && x.roots.length);
  if (!fresh.length) return [];
  const removed = [];
  for (const c of candidates) {
    try {
      const r = c.kind === 'local' ? await LOCAL.engineOf(c.project) : await repoFor(c.project);
      const roots = await r.roots();
      const hit = fresh.find((x) => x.roots.some((y) => roots.includes(y)));
      if (!hit) continue;
      if (c.kind === 'local') await LOCAL.removeFromDevice(c.project, { tomb: hit.id });
      else removeFromDevice(c.project, { tomb: hit.id });
      removed.push(c.project.name);
    } catch (e) {}
  }
  return removed;
}

// Silinenler'den geri yüklenen projenin "silindi" kaydı bu cihazda artık uygulanmaz
export function ignoreTomb(id) {
  if (!id) return;
  const flags = WS.loadFlags();
  WS.saveFlags({ ...flags, ignoredTombs: [...new Set([...(flags.ignoredTombs || []), id])].slice(-200) });
}

// ---------------------------------------------------------------- cihazlar
const dedupePeers = (peers) => {
  const m = new Map();
  for (const x of peers || []) if (x && x.id && (!m.has(x.id) || m.get(x.id).time < x.time)) m.set(x.id, { id: x.id, device: x.device || '', time: x.time || 0 });
  return [...m.values()];
};
const PHONE_NAMES = new Set(['iPhone', 'iPad']);

// Projeyi kullanan cihazlar: [{ name, time, self, phone }] (bu cihaz başta, sonra en son eşitleyen)
// Drive'lı projede uç dosyalarındaki cihaz adları; yalnızca GitHub'lı projede kayıtlardaki telefon/iPad yazarları.
export function devicesOf(p, history) {
  const conns = connectionsOf(p);
  const out = new Map();
  const add = (name, time, extra = {}) => {
    if (!name) return;
    const prev = out.get(name);
    if (!prev || prev.time < time) out.set(name, { name, time, phone: PHONE_NAMES.has(name), ...(prev && prev.self ? { self: true } : {}), ...extra });
  };
  const me = author().name;
  add(me, Date.now(), { self: true });
  const peers = conns.drive ? WS.loadState(conns.drive).devices || [] : [];
  for (const x of peers) if (x.id !== deviceId()) add(x.device || t('devices.unknown'), x.time);
  if (!peers.length) for (const h of (history || []).slice(0, 300)) if (PHONE_NAMES.has(h.author) && h.author !== me) add(h.author, h.time);
  return [...out.values()].sort((a, b) => (b.self ? 1 : 0) - (a.self ? 1 : 0) || b.time - a.time).slice(0, 8);
}
