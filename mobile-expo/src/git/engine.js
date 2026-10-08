// Telefonun git motoru: her proje için cihazda TAM bir git geçmişi (isomorphic-git ile).
// React Native'e bağımlı değildir; depolama arka ucu dışarıdan verilir (backendExpo / testte backendNode).
//
// Masaüstüyle (app/core/engine.js + github.js) aynı kurallar:
//   - kayıt mesajı kuyruğu  "\n\nacadamiv: {v, kind, total, words, delta, changed, deleted}"
//   - dal 'main'; ref en son yazılır, her ref değişimi günlüğe (acadamiv-journal.log) eklenir;
//     açılışta ref bozuksa günlükteki son sağlam kayda dönülür (repairIfNeeded)
//   - eşitleme: fetch → ileri sarma (applyRemote) ya da ayrışma (mergeDiverged) → push;
//     kayıt noktasına girmemiş yerel düzenlemenin üzerine ASLA yazılmaz, diğer cihazın hali
//     "<ad> (diğer cihazdan).<uzantı>" kopyası olarak gelir.
// Telefon için: dosyalar sırayla işlenir, aynı anda bellekte en fazla bir büyük dosya bulunur.
import './polyfill.js';
import * as git from 'isomorphic-git';
import { createFs, joinPath, normPath, dirnameOf, writeAtomic, readTextOrNull, appendText } from './fsAdapter.js';
import { http as defaultHttp, onAuth } from './http.js';
import { countWords, countsWords, conflictName } from '../wsCore.js';
import { snapshotTitle, VERSIONS_FOLDER } from '../localCore.js';

export const gitEngineVersion = 1;
export const BRANCH = 'main';
export const TRAILER = '\n\nacadamiv:';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Masaüstündeki engine.js ile aynı yok sayma kuralları + gizli dosyalar ve _Sürümler klasörü
const IGNORE_DIRS = new Set(['.git', '.acadamiv', '.draftrewind', 'node_modules', '__pycache__', '.ipynb_checkpoints', '$recycle.bin', 'system volume information']);
const IGNORE_FILE = /^(~\$|~wrl|\.~lock\.|\.ds_store$|thumbs\.db$|desktop\.ini$|\.dropbox|\.tmp\.driveupload)/i;
const IGNORE_EXT = /\.(tmp|temp|bak|lnk|crdownload|part|partial|swp|asd|wbk)$/i;
const nfc = (s) => {
  try {
    return String(s).normalize('NFC');
  } catch (e) {
    return String(s);
  }
};
const VERSIONS_NFC = nfc(VERSIONS_FOLDER);

export function ignoredDir(name) {
  return name.startsWith('.') || IGNORE_DIRS.has(name.toLowerCase()) || nfc(name) === VERSIONS_NFC;
}
export function ignoredFile(name) {
  return name.startsWith('.') || name.startsWith('~$') || IGNORE_FILE.test(name) || IGNORE_EXT.test(name);
}
// Telefonun taramadığı yol (geçmişte varsa korunur, "silindi" sayılmaz)
export function ignoredPath(rel) {
  const parts = String(rel).split('/');
  for (let i = 0; i < parts.length - 1; i++) if (ignoredDir(parts[i])) return true;
  return ignoredFile(parts[parts.length - 1]);
}

// ---------------------------------------------------------------- metin tablosu
// Varsayılan Türkçe (i18n.js'teki local.t.* ve masaüstündeki snap.gh* ile aynı); uygulama kendi t()'sini verebilir.
const TR = {
  'local.t.added': 'Yeni dosya: {name}',
  'local.t.wordsAdded': '{name}: {n} kelime eklendi',
  'local.t.wordsRemoved': '{name}: {n} kelime silindi',
  'local.t.updated': '{name} güncellendi',
  'local.t.deleted': '{name} silindi',
  'local.t.many': '{name} ve {n} dosya daha güncellendi',
  'local.t.deletedCount': '{n} dosya silindi',
  'local.t.words': ' ({n} kelime)',
  'local.t.default': 'Kayıt noktası',
  'snap.ghMerged': 'Diğer cihazla birleştirildi ({n} dosyanın iki hali de saklandı)',
  'snap.ghPulled': 'Diğer cihazdaki değişiklikler alındı',
};
export const defaultT = (key, vars = {}) => (TR[key] || key).replace(/\{(\w+)\}/g, (m, n) => (vars[n] != null ? String(vars[n]) : m));

// ---------------------------------------------------------------- mesaj
// Masaüstündeki parseMessage'ın aynısı
export function parseMessage(message) {
  const idx = message.indexOf(TRAILER);
  let meta = {};
  let body = message;
  if (idx >= 0) {
    body = message.slice(0, idx);
    try {
      meta = JSON.parse(message.slice(idx + TRAILER.length).trim());
    } catch (e) {}
  }
  const [title, ...rest] = body.split('\n');
  const clean = title.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s{2,}/g, ' ').trim();
  return { title: clean, note: rest.join('\n').trim(), meta };
}

export function buildCommitMessage(title, note, meta) {
  return `${title}${note ? `\n\n${note}` : ''}${TRAILER} ${JSON.stringify(meta)}\n`;
}

function who(author, now) {
  const d = new Date(now);
  return {
    name: (author && author.name) || 'DraftRewind',
    email: (author && author.email) || 'kayit@draftrewind.local',
    timestamp: Math.floor(d.getTime() / 1000),
    timezoneOffset: d.getTimezoneOffset(),
  };
}

const sumWords = (words) => Object.values(words || {}).reduce((a, b) => a + (Number(b) || 0), 0);

// Uzun döngülerde arayüze sıra ver (telefonda JS ve dokunmatik aynı iş parçacığında)
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function historyItem(oid, commit) {
  const { title, note, meta } = parseMessage(commit.message);
  return {
    oid,
    title,
    note,
    kind: meta.kind || 'auto',
    time: commit.committer.timestamp * 1000,
    author: commit.author.name,
    total: meta.total,
    words: meta.words && typeof meta.words === 'object' ? meta.words : null,
    delta: meta.delta || {},
    changed: meta.changed,
    deleted: meta.deleted || [],
    parents: commit.parent,
  };
}

function codedError(code, message, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

// ---------------------------------------------------------------- proje
export class GitProject {
  constructor({ backend, gitdir, dir, id, name, author, t, maxFileBytes }) {
    this.backend = backend;
    this.fs = createFs(backend);
    this.gitdir = normPath(gitdir);
    this.dir = normPath(dir);
    this.id = id;
    this.name = name;
    this.author = author || {};
    this.T = t || defaultT;
    this.maxFileBytes = maxFileBytes || MAX_FILE_BYTES;
    this.cacheFile = joinPath(this.gitdir, 'acadamiv-cache.json');
    this.journalFile = joinPath(this.gitdir, 'acadamiv-journal.log');
    this.hashCache = {};
    this.treeCache = new Map();
    this.wordsCache = null;
    this.gitCache = {};
    this.queue = Promise.resolve();
    this.skipped = [];
  }

  // isomorphic-git çağrılarının ortak parametreleri (paket dizini önbelleği işlem başına sıfırlanır)
  g(extra) {
    return { fs: this.fs, gitdir: this.gitdir, cache: this.gitCache, ...extra };
  }

  // Aynı projede işlemler sırayla çalışsın (kayıt ve eşitleme çakışmasın)
  exclusive(fn) {
    const run = this.queue.then(
      () => {
        this.gitCache = {};
        return fn();
      },
      () => {
        this.gitCache = {};
        return fn();
      }
    );
    this.queue = run.catch(() => {});
    return run;
  }

  async open() {
    await this.backend.mkdirp(this.gitdir);
    await this.backend.mkdirp(this.dir);
    if (!(await this.backend.stat(joinPath(this.gitdir, 'HEAD')))) {
      await git.init({ fs: this.fs, dir: this.dir, gitdir: this.gitdir, defaultBranch: BRANCH });
    }
    try {
      this.hashCache = JSON.parse((await readTextOrNull(this.backend, this.cacheFile)) || '{}') || {};
    } catch (e) {
      this.hashCache = {};
    }
    await this.repairIfNeeded();
    return this;
  }

  // Yarım yazılmış dal referansı: günlükten son sağlam kaydı geri yükle (masaüstüyle aynı)
  async repairIfNeeded() {
    let ok = false;
    try {
      const head = await git.resolveRef(this.g({ ref: BRANCH }));
      await git.readCommit(this.g({ oid: head }));
      ok = true;
    } catch (e) {}
    if (ok) return false;
    const text = (await readTextOrNull(this.backend, this.journalFile)) || '';
    const lines = text.trim().split('\n').reverse();
    for (const line of lines) {
      const oid = line.split(' ')[1];
      if (!oid || oid.length !== 40) continue;
      try {
        const c = await git.readCommit(this.g({ oid }));
        await git.readTree(this.g({ oid: c.commit.tree }));
        await this.setHead(oid, false);
        return true;
      } catch (e) {}
    }
    // Hiç sağlam kayıt yok: boş depo gibi davran (bozuk ref dosyası kaldırılır)
    try {
      await this.backend.remove(joinPath(this.gitdir, 'refs', 'heads', BRANCH));
    } catch (e) {}
    return false;
  }

  async head() {
    try {
      return await git.resolveRef(this.g({ ref: BRANCH }));
    } catch (e) {
      return null;
    }
  }

  async setHead(oid, journal = true) {
    await git.writeRef(this.g({ ref: `refs/heads/${BRANCH}`, value: oid, force: true }));
    if (journal) await appendText(this.backend, this.journalFile, `${Date.now()} ${oid}\n`);
  }

  async saveHashCache() {
    try {
      await writeAtomic(this.backend, this.cacheFile, JSON.stringify(this.hashCache));
    } catch (e) {}
  }

  // ------------------------------------------------------------ çalışma klasörü
  // Geçmişteki adlar her zaman NFC'dir (Windows böyle yazar). iOS ise Türkçe harfleri diske ayrışık (NFD)
  // yazıp öyle listeler; son taramada görülen gerçek disk adı varsa o kullanılır.
  work(rel) {
    const disk = (this.diskNames && this.diskNames.get(rel)) || rel;
    return joinPath(this.dir, ...String(disk).split('/'));
  }

  // İzlenen dosyalar: Map(rel → { size, mtimeMs }); sınırı aşanlar this.skipped'e (geçmişe girmez)
  async scan() {
    const out = new Map();
    const skipped = [];
    const diskNames = new Map();
    const walk = async (abs, rel, raw) => {
      let names;
      try {
        names = await this.backend.list(abs);
      } catch (e) {
        return;
      }
      names = [...names].sort();
      let k = 0;
      for (const name of names) {
        if (++k % 25 === 0) await tick();
        const full = joinPath(abs, name);
        let st;
        try {
          st = await this.backend.stat(full);
        } catch (e) {
          continue;
        }
        if (!st) continue;
        const r = rel ? `${rel}/${nfc(name)}` : nfc(name);
        const rr = raw ? `${raw}/${name}` : name;
        if (st.type === 'dir') {
          if (ignoredDir(name)) continue;
          await walk(full, r, rr);
        } else {
          if (ignoredFile(name)) continue;
          if (st.size > this.maxFileBytes) {
            skipped.push({ path: r, reason: 'tooBig', size: st.size });
            continue;
          }
          if (out.has(r)) continue; // aynı adın NFC ve NFD kopyası (yalnızca NTFS/ext4'te olabilir): ilki
          out.set(r, { size: st.size, mtimeMs: st.mtimeMs });
          if (rr !== r) diskNames.set(r, rr);
        }
      }
    };
    await walk(this.dir, '', '');
    this.skipped = skipped;
    this.diskNames = diskNames;
    return { files: out, skipped };
  }

  async readWorking(rel) {
    const abs = this.work(rel);
    const st = await this.backend.stat(abs);
    if (!st || st.type !== 'file') return null;
    if (st.size > this.maxFileBytes) throw codedError('ETOOLARGE', 'file too large');
    return this.backend.readBytes(abs);
  }

  async writeWorking(rel, bytes) {
    const abs = this.work(rel);
    await this.backend.mkdirp(dirnameOf(abs));
    await writeAtomic(this.backend, abs, bytes);
  }

  async removeWorking(rel) {
    try {
      const abs = this.work(rel);
      if (await this.backend.stat(abs)) await this.backend.remove(abs);
    } catch (e) {}
  }

  // ------------------------------------------------------------ ağaçlar
  async treeFiles(commitOid) {
    if (!commitOid) return new Map();
    if (this.treeCache.has(commitOid)) return this.treeCache.get(commitOid);
    const { commit } = await git.readCommit(this.g({ oid: commitOid }));
    const files = new Map();
    const walk = async (treeOid, prefix) => {
      const { tree } = await git.readTree(this.g({ oid: treeOid }));
      for (const e of tree) {
        const p = prefix ? `${prefix}/${e.path}` : e.path;
        if (e.type === 'tree') await walk(e.oid, p);
        else if (e.type === 'blob') files.set(p, e.oid);
      }
    };
    await walk(commit.tree, '');
    if (this.treeCache.size > 50) this.treeCache.clear();
    this.treeCache.set(commitOid, files);
    return files;
  }

  async writeTreeFromMap(fileMap) {
    const root = { dirs: new Map(), files: [] };
    for (const [rel, oid] of fileMap) {
      const parts = rel.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { dirs: new Map(), files: [] });
        node = node.dirs.get(parts[i]);
      }
      node.files.push({ mode: '100644', path: parts[parts.length - 1], oid, type: 'blob' });
    }
    const write = async (node) => {
      const entries = [...node.files];
      for (const [name, child] of node.dirs) entries.push({ mode: '040000', path: name, oid: await write(child), type: 'tree' });
      return git.writeTree(this.g({ tree: entries }));
    };
    return write(root);
  }

  async readBlob(oid) {
    const { blob } = await git.readBlob(this.g({ oid }));
    return blob;
  }

  async lastMeta(oid) {
    if (!oid) return {};
    try {
      const { commit } = await git.readCommit(this.g({ oid }));
      return parseMessage(commit.message).meta || {};
    } catch (e) {
      return {};
    }
  }

  // Kelime sayıları için başlangıç: ilk-ebeveyn zincirinde "words" taşıyan en yakın kayıt
  // (masaüstündeki wordsBase); aradaki kayıtlarda değişen dosyalar yeniden sayılır.
  async wordsBase(headOid, headFiles, limit = 200) {
    if (this.wordsCache && this.wordsCache.head === headOid) return { ...this.wordsCache.words };
    let oid = headOid;
    let found = null;
    for (let i = 0; oid && i < limit; i++) {
      let commit;
      try {
        ({ commit } = await git.readCommit(this.g({ oid })));
      } catch (e) {
        break;
      }
      const meta = parseMessage(commit.message).meta || {};
      if (meta.words && typeof meta.words === 'object') {
        found = { oid, words: { ...meta.words } };
        break;
      }
      oid = commit.parent[0] || null;
    }
    if (!found) return {};
    const words = found.words;
    if (found.oid !== headOid && headOid) {
      try {
        const baseFiles = await this.treeFiles(found.oid);
        const current = headFiles || (await this.treeFiles(headOid));
        for (const rel of Object.keys(words)) if (!current.has(rel)) delete words[rel];
        for (const [rel, blobOid] of current) {
          if (baseFiles.get(rel) === blobOid || !countsWords(rel)) continue;
          const n = await countWords(rel, await this.readBlob(blobOid));
          if (n != null) words[rel] = n;
        }
      } catch (e) {}
    }
    this.wordsCache = { head: headOid, words: { ...words } };
    return words;
  }

  // ------------------------------------------------------------ kayıt noktası
  // kind: auto | star | rescue | restore | mobile ... ; now: zaman (ms). Birleştirme (3 dk) çağıranın işidir.
  // Dönen: null (değişiklik yok) ya da { oid, title, kind, changed, added, deleted, delta, total, skipped }
  snapshot(opts) {
    return this.exclusive(() => this.snapshotNow(opts));
  }

  async snapshotNow({ kind = 'auto', title, note, now, force = false } = {}) {
    const time = now == null ? Date.now() : now;
    const head = await this.head();
    const headFiles = await this.treeFiles(head);
    const { files, skipped } = await this.scan();
    const tree = new Map();
    // Telefonun taramadığı (gizli vb.) ya da sınırı aşan dosyaların geçmişteki hali korunur
    for (const [rel, oid] of headFiles) if (ignoredPath(rel)) tree.set(rel, oid);
    for (const s of skipped) if (headFiles.has(s.path)) tree.set(s.path, headFiles.get(s.path));

    const nextCache = {};
    const changed = [];
    const counts = {};
    // Sırayla: her dosya okunur → özetlenir → gerekiyorsa yazılır → bellekten bırakılır
    let k = 0;
    for (const [rel, f] of files) {
      if (++k % 10 === 0) await tick();
      const c = this.hashCache[rel];
      const headOid = headFiles.get(rel);
      if (c && c.m === f.mtimeMs && c.s === f.size && c.oid === headOid) {
        tree.set(rel, c.oid);
        nextCache[rel] = c;
        continue;
      }
      let bytes;
      try {
        bytes = await this.backend.readBytes(this.work(rel));
      } catch (e) {
        // Okunamadı (kilitli/indirilmemiş): bu kayıtta eski hali kalsın, sonra tekrar denenir
        if (headOid) tree.set(rel, headOid);
        continue;
      }
      const { oid } = await git.hashBlob({ object: bytes });
      if (oid !== headOid) {
        await git.writeBlob(this.g({ blob: bytes }));
        changed.push(rel);
        if (countsWords(rel)) counts[rel] = await countWords(rel, bytes);
      }
      bytes = null;
      tree.set(rel, oid);
      nextCache[rel] = { m: f.mtimeMs, s: f.size, oid };
    }
    const deleted = [...headFiles.keys()].filter((rel) => !tree.has(rel));
    this.hashCache = nextCache;
    if (!force && !changed.length && !deleted.length) {
      await this.saveHashCache();
      return null;
    }

    const words = await this.wordsBase(head, headFiles);
    const delta = {};
    for (const rel of deleted) {
      if (words[rel] != null) delta[rel] = -words[rel];
      delete words[rel];
    }
    for (const rel of changed) {
      const n = counts[rel];
      if (n == null) continue;
      delta[rel] = n - (words[rel] || 0);
      words[rel] = n;
    }
    const total = sumWords(words);
    const added = changed.filter((rel) => !headFiles.has(rel));
    const finalTitle = title || snapshotTitle({ changed, added, deleted, delta }, this.T);
    const meta = { v: 1, kind, total, words, delta, changed, deleted };
    const treeOid = await this.writeTreeFromMap(tree);
    const w = who(this.author, time);
    const oid = await git.writeCommit(
      this.g({ commit: { message: buildCommitMessage(finalTitle, note, meta), tree: treeOid, parent: head ? [head] : [], author: w, committer: w } })
    );
    await this.setHead(oid);
    this.treeCache.set(oid, tree);
    this.wordsCache = { head: oid, words: { ...words } };
    await this.saveHashCache();
    return { oid, title: finalTitle, kind, changed, added, deleted, delta, total, skipped };
  }

  // ------------------------------------------------------------ geçmiş
  // En yeniden eskiye (git log gibi: tüm ebeveynler, işleme zamanına göre). known: daha önce okunmuş
  // liste (en yenisi başta) — eski uç bu zincirdeyse yalnızca yeni kayıtlar okunur. Arada arayüze nefes aldırır.
  async history({ limit = 300, file, known = null } = {}) {
    const head = await this.head();
    if (!head) return [];
    let base = known && known.length ? known : null;
    let items;
    if (base && base[0].oid === head) items = base.slice(0, limit);
    else {
      items = await this.walkHistory(head, limit, base);
      if (!items) items = await this.walkHistory(head, limit, null);
    }
    if (!file) return items;
    return items.filter((it) => (it.changed || []).includes(file) || (it.deleted || []).includes(file) || !it.changed);
  }

  // base verilirse ve eski uç (base[0]) bu zincirde değilse (geçmiş yeniden yazılmış) null döner
  async walkHistory(head, limit, base) {
    const knownIds = base ? new Set(base.map((k) => k.oid)) : null;
    const seen = new Set();
    const pending = new Map();
    let hitHead = false;
    const load = async (oid) => {
      if (seen.has(oid)) return;
      seen.add(oid);
      if (knownIds && knownIds.has(oid)) {
        if (oid === base[0].oid) hitHead = true;
        return;
      }
      try {
        const { commit } = await git.readCommit(this.g({ oid }));
        pending.set(oid, commit);
      } catch (e) {}
    };
    await load(head);
    const fresh = [];
    while (pending.size && fresh.length < limit) {
      let best = null;
      for (const [oid, c] of pending) if (!best || c.committer.timestamp > best[1].committer.timestamp) best = [oid, c];
      pending.delete(best[0]);
      fresh.push(historyItem(best[0], best[1]));
      for (const par of best[1].parent) await load(par);
      if (fresh.length % 20 === 0) await tick();
    }
    if (!base || fresh.length >= limit) return fresh;
    if (!hitHead) return null;
    const all = fresh.concat(base);
    const uniq = [];
    const ids = new Set();
    for (const it of all) if (!ids.has(it.oid)) (ids.add(it.oid), uniq.push(it));
    uniq.sort((a, b) => b.time - a.time);
    return uniq.slice(0, limit);
  }

  // Bir dosyanın bir kayıttaki hali (Uint8Array) ya da null. oid === 'working' → klasördeki hali.
  async readAt(oid, rel) {
    if (oid === 'working') return this.readWorking(rel);
    const files = await this.treeFiles(oid);
    const blobOid = files.get(rel);
    if (!blobOid) return null;
    return this.readBlob(blobOid);
  }

  // Kaydın ilk ebeveynine göre değişen dosyalar: [{ rel, change: added | modified | deleted, delta }]
  async changes(oid) {
    const { commit } = await git.readCommit(this.g({ oid }));
    const after = await this.treeFiles(oid);
    const before = await this.treeFiles(commit.parent[0] || null);
    const { meta } = parseMessage(commit.message);
    const rows = [];
    for (const [rel, o] of after) {
      if (!before.has(rel)) rows.push({ rel, change: 'added' });
      else if (before.get(rel) !== o) rows.push({ rel, change: 'modified' });
    }
    for (const rel of before.keys()) if (!after.has(rel)) rows.push({ rel, change: 'deleted' });
    return rows.map((r) => ({ ...r, delta: (meta.delta || {})[r.rel] ?? null }));
  }

  // ------------------------------------------------------------ eşitleme
  // Masaüstündeki github.sync ile aynı anlam. opts: { remoteUrl, token, http, force, pushedOid, repoExists }
  //   pushedOid  : bu cihazın en son gönderdiği kayıt (masaüstündeki meta.githubOid); uzak zincir yeniden
  //                yazılmışsa (seyreltme) ve yerelde gönderilmemiş kayıt yoksa uzak zincir benimsenir
  //   repoExists : async () => boolean; uzak boş/bulunamadı ise depo silinmiş mi diye sorulur (false → EGHREPO)
  //   noPush     : yalnızca al (otomatik gönderim kapalıyken); yerel kayıtlar bekler
  //   baseFiles  : { yol: blobOid } — bu cihazda henüz kayıt yokken klasördeki dosyaların hangi uzak halden
  //                geldiği (eski çalışma alanının indirme kaydı). Verilirse ilk alışta bu dosyalar "yerelde
  //                düzenlenmiş" sayılmaz; düzenlenmemiş eski kopyalar uzaktaki yeni halle değişir.
  // Dönen: { pushed, pulled, conflicts, head, remote, ahead, at }
  sync(opts) {
    return this.exclusive(() => this.syncNow(opts));
  }

  // Önce kayıt noktası, sonra eşitleme (tek sıra içinde)
  syncWithSnapshot({ snapshot: snapOpts, ...syncOpts } = {}) {
    return this.exclusive(async () => {
      const snap = await this.snapshotNow(snapOpts || {});
      const res = await this.syncNow(syncOpts);
      return { ...res, snapshot: snap };
    });
  }

  async syncNow({ remoteUrl, token, http = defaultHttp, force = false, pushedOid = null, repoExists = null, noPush = false, baseFiles = null } = {}) {
    if (!remoteUrl) throw codedError('ENOREMOTE', 'remoteUrl gerekli');
    const auth = onAuth(token || '');
    await git.addRemote(this.g({ remote: 'origin', url: remoteUrl, force: true }));
    let remoteOid = null;
    try {
      await git.fetch(this.g({ http, url: remoteUrl, remote: 'origin', ref: BRANCH, singleBranch: true, tags: false, onAuth: auth }));
      remoteOid = await git.resolveRef(this.g({ ref: `refs/remotes/origin/${BRANCH}` }));
    } catch (e) {
      const msg = String((e && (e.message || e.code)) || e);
      if (/401|403|Unauthorized/i.test(msg)) throw codedError('EGHAUTH', msg, e);
      if (/Could not find|NotFoundError|empty|couldn't find remote ref|404/i.test(msg)) {
        // Boş depo (henüz hiç gönderilmemiş) → sadece göndereceğiz; depo silinmiş olabilir: sorulur
        if (repoExists) {
          const exists = await repoExists();
          if (exists === false) throw codedError('EGHREPO', msg, e);
        }
      } else if (/HttpError/i.test(msg)) {
        throw codedError('EGHAUTH', msg, e);
      } else {
        throw e;
      }
    }

    let local = await this.head();
    let pulled = 0;
    let conflicts = [];
    this.pulledCopies = [];

    if (remoteOid && local && remoteOid !== local) {
      const remoteAhead = await git.isDescendent(this.g({ oid: remoteOid, ancestor: local, depth: -1 }));
      const localAhead = !remoteAhead && (await git.isDescendent(this.g({ oid: local, ancestor: remoteOid, depth: -1 })));
      if (remoteAhead) {
        pulled = await this.applyRemote(local, remoteOid);
        await this.setHead(remoteOid);
        local = remoteOid;
      } else if (!localAhead && !force) {
        if (pushedOid && pushedOid === local) {
          // Yerelde gönderilmemiş kayıt yok; uzak zincir yeniden yazılmış: olduğu gibi benimse
          pulled = await this.applyRemote(local, remoteOid);
          await this.setHead(remoteOid);
          this.treeCache.clear();
          this.wordsCache = null;
          local = remoteOid;
        } else {
          const res = await this.mergeDiverged(local, remoteOid);
          pulled = res.pulled;
          conflicts = res.conflicts;
          local = res.oid;
        }
      }
    } else if (remoteOid && !local) {
      pulled = await this.applyRemote(null, remoteOid, baseFiles ? new Map(Object.entries(baseFiles)) : null);
      await this.setHead(remoteOid);
      local = remoteOid;
    }

    if (local && local !== remoteOid && !noPush) {
      let r;
      try {
        r = await git.push(this.g({ http, url: remoteUrl, remote: 'origin', ref: BRANCH, remoteRef: BRANCH, force: !!force, onAuth: auth }));
      } catch (e) {
        const msg = String((e && (e.message || e.code)) || e);
        if (/401|403|Unauthorized/i.test(msg)) throw codedError('EGHAUTH', msg, e);
        throw e;
      }
      if (r && r.ok === false) throw codedError('EGHPUSH', 'push failed');
    }
    conflicts = [...this.pulledCopies, ...conflicts];
    const pushed = !noPush && !!local && local !== remoteOid;
    const remote = pushed ? local : remoteOid;
    return { pushed, pulled, conflicts, head: local || null, remote: remote || null, ahead: !!local && local !== remote, at: Date.now() };
  }

  // Klasördeki dosya HEAD halinden farklı mı? (kayıt noktasına girmemiş düzenleme). Okunamıyorsa "farklı".
  async localDiffers(rel, headOid) {
    let st;
    try {
      st = await this.backend.stat(this.work(rel));
    } catch (e) {
      return true;
    }
    if (!st) return false;
    if (st.type !== 'file') return true;
    if (!headOid) return true;
    const c = this.hashCache[rel];
    if (c && c.m === st.mtimeMs && c.s === st.size) return c.oid !== headOid;
    try {
      const bytes = await this.readWorking(rel);
      const { oid } = await git.hashBlob({ object: bytes });
      return oid !== headOid;
    } catch (e) {
      return true;
    }
  }

  // Klasördeki dosyanın blob oid'i: undefined (dosya yok), null (okunamadı) ya da oid
  async workingOid(rel) {
    let st;
    try {
      st = await this.backend.stat(this.work(rel));
    } catch (e) {
      return null;
    }
    if (!st) return undefined;
    if (st.type !== 'file') return null;
    const c = this.hashCache[rel];
    if (c && c.m === st.mtimeMs && c.s === st.size) return c.oid;
    try {
      const { oid } = await git.hashBlob({ object: await this.readWorking(rel) });
      return oid;
    } catch (e) {
      return null;
    }
  }

  // Bir kaydın ilk ebeveyni ve değişen dosyaları (GitHub'ın "commit files" yanıtı biçiminde)
  async commitFiles(oid) {
    const { commit } = await git.readCommit(this.g({ oid }));
    const rows = await this.changes(oid);
    return { parent: commit.parent[0] || null, files: rows.map((r) => ({ path: r.rel, status: r.change === 'deleted' ? 'removed' : r.change })) };
  }

  // Uzaktaki dalın bu cihazın bildiği son hali (eşitlemeden sonra); yoksa null
  async remoteHead() {
    try {
      return await git.resolveRef(this.g({ ref: `refs/remotes/origin/${BRANCH}` }));
    } catch (e) {
      return null;
    }
  }

  // Büyük/küçük harf değişimi: aynı dosya sayılır (iOS/Windows/macOS dosya sistemleri harf duyarsız)
  static sameNameOtherCase(rel, map) {
    const low = rel.toLowerCase();
    for (const k of map.keys()) if (k !== rel && k.toLowerCase() === low) return true;
    return false;
  }

  // Uzak kayıt yerelin devamı: yalnızca değişen dosyalar klasöre yazılır; yerel düzenleme ezilmez.
  async applyRemote(localOid, remoteOid, beforeOverride = null) {
    const before = beforeOverride || (await this.treeFiles(localOid));
    const after = await this.treeFiles(remoteOid);
    let n = 0;
    for (const rel of before.keys()) {
      if (after.has(rel) || GitProject.sameNameOtherCase(rel, after)) continue;
      if (await this.localDiffers(rel, before.get(rel))) continue;
      await this.removeWorking(rel);
    }
    for (const [rel, oid] of after) {
      if (before.get(rel) === oid && !beforeOverride) continue;
      await tick();
      const wo = await this.workingOid(rel);
      if (wo === oid) continue; // klasörde zaten bu hali var
      if (before.get(rel) === oid && wo !== undefined) continue; // uzak değişmemiş; yerel düzenleme kalır
      const keepLocal = wo !== undefined && wo !== before.get(rel);
      let blob = await this.readBlob(oid);
      try {
        await this.writeWorking(keepLocal ? conflictName(rel) : rel, blob);
        if (keepLocal && this.pulledCopies) this.pulledCopies.push(conflictName(rel));
      } catch (e) {
        await this.writeWorking(conflictName(rel), blob);
        if (this.pulledCopies) this.pulledCopies.push(conflictName(rel));
      }
      blob = null;
      n++;
    }
    return n;
  }

  async mergeDiverged(localOid, remoteOid) {
    const [baseOid] = await git.findMergeBase(this.g({ oids: [localOid, remoteOid] }));
    const base = await this.treeFiles(baseOid || null);
    const mine = await this.treeFiles(localOid);
    const theirs = await this.treeFiles(remoteOid);
    const result = new Map(mine);
    const conflicts = [];
    let pulled = 0;
    const all = new Set([...base.keys(), ...mine.keys(), ...theirs.keys()]);
    for (const rel of all) {
      const b = base.get(rel);
      const m = mine.get(rel);
      const t = theirs.get(rel);
      if (m === t || t === b) continue; // diğer taraf değiştirmemiş
      if (m === b) {
        // Yalnızca diğer cihaz değiştirmiş → onu al (yerelde kayıt dışı düzenleme varsa kopya olarak)
        const keepLocal = await this.localDiffers(rel, m);
        if (t) {
          const blob = await this.readBlob(t);
          if (keepLocal) {
            const copy = conflictName(rel);
            await this.writeWorking(copy, blob);
            result.set(copy, t);
            conflicts.push(copy);
          } else {
            await this.writeWorking(rel, blob);
          }
          result.set(rel, t);
        } else if (!keepLocal && !GitProject.sameNameOtherCase(rel, theirs)) {
          await this.removeWorking(rel);
          result.delete(rel);
        }
        pulled++;
        continue;
      }
      // İki taraf da değiştirmiş: yerel kalır, diğeri kopya olarak eklenir
      if (t) {
        const copy = conflictName(rel);
        await this.writeWorking(copy, await this.readBlob(t));
        result.set(copy, t);
        conflicts.push(copy);
      }
    }
    const treeOid = await this.writeTreeFromMap(result);
    const w = who({ name: 'DraftRewind', email: 'kayit@draftrewind.local' }, Date.now());
    const prevMeta = await this.lastMeta(localOid);
    const meta = { v: 1, kind: 'merge', total: prevMeta.total, words: prevMeta.words, delta: {}, changed: conflicts, deleted: [] };
    const title = conflicts.length ? this.T('snap.ghMerged', { n: conflicts.length, count: conflicts.length }) : this.T('snap.ghPulled');
    const oid = await git.writeCommit(this.g({ commit: { message: `${title}${TRAILER} ${JSON.stringify(meta)}\n`, tree: treeOid, parent: [localOid, remoteOid], author: w, committer: w } }));
    await this.setHead(oid);
    // Karma çalışma klasörü: önbellek tazelensin
    this.hashCache = {};
    return { oid, pulled, conflicts };
  }

  // ------------------------------------------------------------ yerel geçmişi aktarma
  importLocalLog(opts) {
    return this.exclusive(() => importLocalLog(this, opts));
  }
}

// Hesapsız/iCloud projesinin kayıt listesini (src/localCore.js kayıtları + kopyalar) git kayıtlarına çevirir.
// records: kayıtlar (herhangi bir sırada; zamana göre eskiden yeniye işlenir)
// readCopy(record, path) → Uint8Array | null (kopya baytları; local.js'te record.files[path] → ws-history/… ya da _Sürümler/…)
// Her kaydın yazarı/işleyeni = kaydın zamanı. Ref yalnızca sonunda yazılır (yarıda kalırsa hiçbir şey değişmez).
// Dönen: { head, commits: [{ oid, time, recordId }], missing: [{ recordId, path }] }
export async function importLocalLog(project, { records, readCopy }) {
  const list = [...(records || [])].filter((r) => r && r.time).sort((a, b) => a.time - b.time);
  let parent = await project.head();
  const tree = new Map(await project.treeFiles(parent));
  let prevWords = await project.wordsBase(parent, tree);
  const commits = [];
  const missing = [];
  for (const r of list) {
    const changed = [];
    const deleted = [];
    for (const path of r.changed || []) {
      const ref = r.files && r.files[path];
      let bytes = null;
      if (ref) {
        try {
          bytes = await readCopy(r, path);
        } catch (e) {
          bytes = null;
        }
      }
      if (!bytes) {
        missing.push({ recordId: r.id, path });
        continue;
      }
      const oid = await git.writeBlob(project.g({ blob: bytes }));
      bytes = null;
      tree.set(path, oid);
      changed.push(path);
    }
    for (const path of r.deleted || []) {
      if (tree.has(path)) {
        tree.delete(path);
        deleted.push(path);
      }
    }
    const words = r.words && typeof r.words === 'object' ? { ...r.words } : { ...prevWords };
    const total = typeof r.total === 'number' ? r.total : sumWords(words);
    const delta = r.delta && typeof r.delta === 'object' ? { ...r.delta } : {};
    const kind = r.kind || 'auto';
    const added = (r.added || []).filter((p) => changed.includes(p));
    const title = r.title || snapshotTitle({ changed, added, deleted, delta }, project.T);
    const meta = { v: 1, kind, total, words, delta, changed, deleted };
    const treeOid = await project.writeTreeFromMap(tree);
    const w = who(project.author, r.time);
    const oid = await git.writeCommit(project.g({ commit: { message: buildCommitMessage(title, '', meta), tree: treeOid, parent: parent ? [parent] : [], author: w, committer: w } }));
    project.treeCache.set(oid, new Map(tree));
    commits.push({ oid, time: r.time, recordId: r.id });
    parent = oid;
    prevWords = words;
  }
  if (commits.length) {
    await project.setHead(parent);
    project.wordsCache = null;
  }
  return { head: parent, commits, missing };
}

// Projeyi açar (yoksa git init, dal 'main'); bozuk ref günlükten onarılır.
export async function openProject({ backend, gitdir, dir, id, name, author, t, maxFileBytes }) {
  const p = new GitProject({ backend, gitdir, dir, id, name, author, t, maxFileBytes });
  await p.open();
  return p;
}
