// Proje motoru: klasördeki dosyaların "kayıt noktalarını" sistemde git kurulu olmadan
// (isomorphic-git ile) saklar. Git verisi öğrencinin klasörüne değil uygulama veri klasörüne
// yazılır; böylece Drive/OneDrive içindeki klasörlerde .git bozulması yaşanmaz.
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const Diff = require('diff');
const docs = require('./docs');
const config = require('./config');
const { atomicWriteFileSync } = require('./store');
const { describeSnapshot } = require('./describe');
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const BRANCH = 'main';
const IGNORE_DIRS = new Set(['.git', '.acadamiv', '.draftrewind', 'node_modules', '__pycache__', '.ipynb_checkpoints', '$recycle.bin', 'system volume information']);
const IGNORE_FILE = /^(~\$|~wrl|\.~lock\.|\.ds_store$|thumbs\.db$|desktop\.ini$|\.dropbox|\.tmp\.driveupload)/i;
const IGNORE_EXT = /\.(tmp|temp|bak|lnk|crdownload|part|partial|swp|asd|wbk)$/i;
const TRAILER = '\n\nacadamiv:';

function toPosix(p) {
    return p.split(path.sep).join('/');
}

function nowAuthor(name, email) {
    const d = new Date();
    return {
        name: name || 'DraftRewind',
        email: email || 'kayit@draftrewind.local',
        timestamp: Math.floor(d.getTime() / 1000),
        timezoneOffset: d.getTimezoneOffset()
    };
}

function parseMessage(message) {
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
    return { title: title.trim(), note: rest.join('\n').trim(), meta };
}

class Project {
    constructor({ id, name, dir, gitdir, author }) {
        this.id = id;
        this.name = name;
        this.dir = dir;
        this.gitdir = gitdir;
        this.author = author || {};
        this.cacheFile = path.join(gitdir, 'acadamiv-cache.json');
        this.journalFile = path.join(gitdir, 'acadamiv-journal.log');
        this.hashCache = {};
        this.treeCache = new Map();
        this.queue = Promise.resolve();
        this.skippedLarge = [];
    }

    // Aynı projede işlemler sırayla çalışsın (eşzamanlı kayıt/eşitleme çakışmasın).
    exclusive(fn) {
        const run = this.queue.then(fn, fn);
        this.queue = run.catch(() => {});
        return run;
    }

    async open() {
        fs.mkdirSync(this.gitdir, { recursive: true });
        if (!fs.existsSync(path.join(this.gitdir, 'HEAD'))) {
            await git.init({ fs, dir: this.dir, gitdir: this.gitdir, defaultBranch: BRANCH });
        }
        try {
            this.hashCache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        } catch (e) {
            this.hashCache = {};
        }
        await this.repairIfNeeded();
    }

    // Elektrik kesintisinde dal referansı yarım yazılmış olabilir: günlükten son sağlam kaydı geri yükle.
    async repairIfNeeded() {
        let ok = false;
        try {
            const head = await git.resolveRef({ fs, gitdir: this.gitdir, ref: BRANCH });
            await git.readCommit({ fs, gitdir: this.gitdir, oid: head });
            ok = true;
        } catch (e) {}
        if (ok) return false;
        let lines = [];
        try {
            lines = fs.readFileSync(this.journalFile, 'utf8').trim().split('\n').reverse();
        } catch (e) {}
        for (const line of lines) {
            const oid = line.split(' ')[1];
            if (!oid || oid.length !== 40) continue;
            try {
                const c = await git.readCommit({ fs, gitdir: this.gitdir, oid });
                await git.readTree({ fs, gitdir: this.gitdir, oid: c.commit.tree });
                await this.setHead(oid, false);
                console.warn(`[DraftRewind] ${this.name}: kayıt zinciri onarıldı → ${oid.slice(0, 7)}`);
                return true;
            } catch (e) {}
        }
        // Hiç sağlam kayıt yok: boş depo gibi davran (bozuk ref dosyasını kaldır).
        try {
            fs.unlinkSync(path.join(this.gitdir, 'refs', 'heads', BRANCH));
        } catch (e) {}
        return false;
    }

    async head() {
        try {
            return await git.resolveRef({ fs, gitdir: this.gitdir, ref: BRANCH });
        } catch (e) {
            return null;
        }
    }

    async setHead(oid, journal = true) {
        await git.writeRef({ fs, gitdir: this.gitdir, ref: `refs/heads/${BRANCH}`, value: oid, force: true });
        if (journal) {
            const fd = fs.openSync(this.journalFile, 'a');
            try {
                fs.writeSync(fd, `${Date.now()} ${oid}\n`);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
        }
    }

    // Klasördeki izlenecek dosyalar
    scanWorkingFiles() {
        const out = new Map();
        const large = [];
        const walk = (abs, rel) => {
            let entries;
            try {
                entries = fs.readdirSync(abs, { withFileTypes: true });
            } catch (e) {
                return;
            }
            for (const e of entries) {
                const name = e.name;
                if (e.isDirectory()) {
                    if (IGNORE_DIRS.has(name.toLowerCase()) || name.startsWith('.')) continue;
                    walk(path.join(abs, name), rel ? `${rel}/${name}` : name);
                } else if (e.isFile()) {
                    if (IGNORE_FILE.test(name) || IGNORE_EXT.test(name)) continue;
                    const full = path.join(abs, name);
                    let st;
                    try {
                        st = fs.statSync(full);
                    } catch (err) {
                        continue;
                    }
                    const r = rel ? `${rel}/${name}` : name;
                    if (st.size > config.MAX_FILE_BYTES) {
                        large.push(r);
                        continue;
                    }
                    out.set(r, { abs: full, size: st.size, mtimeMs: st.mtimeMs });
                }
            }
        };
        walk(this.dir, '');
        this.skippedLarge = large;
        return out;
    }

    async hashWorking(files) {
        const result = new Map();
        const nextCache = {};
        for (const [rel, f] of files) {
            const c = this.hashCache[rel];
            if (c && c.m === f.mtimeMs && c.s === f.size) {
                result.set(rel, c.oid);
                nextCache[rel] = c;
                continue;
            }
            let buf;
            try {
                buf = fs.readFileSync(f.abs);
            } catch (e) {
                // Kilitli dosya (ör. Excel açık) → önceki bilinen sürümü kullan, sonra tekrar denenir
                if (c) {
                    result.set(rel, c.oid);
                    nextCache[rel] = c;
                }
                continue;
            }
            const { oid } = await git.hashBlob({ object: buf });
            result.set(rel, oid);
            nextCache[rel] = { m: f.mtimeMs, s: f.size, oid };
        }
        this.hashCache = nextCache;
        return result;
    }

    saveHashCache() {
        try {
            atomicWriteFileSync(this.cacheFile, JSON.stringify(this.hashCache));
        } catch (e) {}
    }

    async treeFiles(commitOid) {
        if (!commitOid) return new Map();
        if (this.treeCache.has(commitOid)) return this.treeCache.get(commitOid);
        const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid: commitOid });
        const files = new Map();
        const walk = async (treeOid, prefix) => {
            const { tree } = await git.readTree({ fs, gitdir: this.gitdir, oid: treeOid });
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
        const write = async node => {
            const entries = [...node.files];
            for (const [name, child] of node.dirs) {
                entries.push({ mode: '040000', path: name, oid: await write(child), type: 'tree' });
            }
            return git.writeTree({ fs, gitdir: this.gitdir, tree: entries });
        };
        return write(root);
    }

    diffMaps(from, to) {
        const added = [], modified = [], deleted = [];
        for (const [rel, oid] of to) {
            if (!from.has(rel)) added.push(rel);
            else if (from.get(rel) !== oid) modified.push(rel);
        }
        for (const rel of from.keys()) if (!to.has(rel)) deleted.push(rel);
        return { added, modified, deleted };
    }

    async status() {
        const files = this.scanWorkingFiles();
        const working = await this.hashWorking(files);
        const head = await this.head();
        const headFiles = await this.treeFiles(head);
        return { head, working, files, headFiles, changes: this.diffMaps(headFiles, working) };
    }

    async lastMeta(oid) {
        if (!oid) return {};
        try {
            const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid });
            return parseMessage(commit.message).meta || {};
        } catch (e) {
            return {};
        }
    }

    // Kayıt noktası al. kind: auto | star | rescue | restore | merge
    snapshot({ kind = 'auto', title, note, force = false } = {}) {
        return this.exclusive(async () => {
            const st = await this.status();
            const { added, modified, deleted } = st.changes;
            const changed = [...added, ...modified];
            if (!force && changed.length === 0 && deleted.length === 0) {
                this.saveHashCache();
                return null;
            }

            // Değişen dosyaları nesne deposuna yaz (okunduğu andaki içerik esas alınır)
            const tree = new Map(st.working);
            const buffers = new Map();
            for (const rel of changed) {
                let buf;
                try {
                    buf = fs.readFileSync(st.files.get(rel).abs);
                } catch (e) {
                    // Okunamadı: bu kayıtta eski hali kalsın
                    if (st.headFiles.has(rel)) tree.set(rel, st.headFiles.get(rel));
                    else tree.delete(rel);
                    continue;
                }
                const oid = await git.writeBlob({ fs, gitdir: this.gitdir, blob: buf });
                tree.set(rel, oid);
                buffers.set(rel, buf);
            }

            // Kelime istatistikleri (mobil uygulama da bu bilgiyi okur)
            const prev = await this.lastMeta(st.head);
            const words = { ...(prev.words || {}) };
            const delta = {};
            for (const rel of deleted) {
                if (words[rel] != null) delta[rel] = -words[rel];
                delete words[rel];
            }
            for (const [rel, buf] of buffers) {
                const n = await docs.countWords(rel, buf);
                if (n == null) continue;
                delta[rel] = n - (words[rel] || 0);
                words[rel] = n;
            }
            const total = Object.values(words).reduce((a, b) => a + b, 0);

            const realChanged = [...buffers.keys()];
            // Değişikliği yerelde analiz ederek başlık ve ayrıntı üret (dışarıya veri gitmez)
            let summary = null;
            try {
                const files = [];
                for (const rel of realChanged) {
                    const newBuf = buffers.get(rel);
                    if (newBuf.length > 30 * 1024 * 1024) continue;
                    const oldOid = st.headFiles.get(rel);
                    const oldBuf = oldOid ? Buffer.from((await git.readBlob({ fs, gitdir: this.gitdir, oid: oldOid })).blob) : null;
                    files.push({ rel, oldBuf, newBuf });
                }
                for (const rel of deleted) files.push({ rel, oldBuf: Buffer.alloc(1), newBuf: null });
                summary = await describeSnapshot(files, delta);
            } catch (e) {}
            let finalTitle = title || (summary && summary.title) || this.autoTitle(kind, realChanged, deleted, delta);
            if (!title && kind === 'rescue') finalTitle = `⚡ ${T('snap.rescued', { names: realChanged.map(r => path.basename(r)).join(', ') })}`;
            const body = [note, summary && summary.body].filter(Boolean).join('\n\n');
            const meta = { v: 1, kind, total, words, delta, changed: realChanged, deleted };
            const message = `${finalTitle}${body ? `\n\n${body}` : ''}${TRAILER} ${JSON.stringify(meta)}\n`;

            const treeOid = await this.writeTreeFromMap(tree);
            const who = nowAuthor(this.author.name, this.author.email);
            const oid = await git.writeCommit({
                fs,
                gitdir: this.gitdir,
                commit: {
                    message,
                    tree: treeOid,
                    parent: st.head ? [st.head] : [],
                    author: who,
                    committer: who
                }
            });
            await this.setHead(oid);
            this.saveHashCache();
            return { oid, title: finalTitle, kind, changed: realChanged, deleted, delta, total };
        });
    }

    autoTitle(kind, changed, deleted, delta) {
        const base = n => path.basename(n);
        const wordNote = rel => {
            const d = delta[rel];
            if (!d) return '';
            return T('snap.words', { n: d > 0 ? `+${d}` : `${d}`, count: d });
        };
        if (kind === 'rescue') return T('snap.rescued', { names: changed.map(base).join(', ') });
        if (changed.length === 1 && deleted.length === 0) return T('snap.updated', { name: base(changed[0]), words: wordNote(changed[0]) });
        if (changed.length === 0 && deleted.length === 1) return T('snap.deleted', { name: base(deleted[0]) });
        const parts = [];
        if (changed.length) parts.push(T('snap.updatedMany', { name: base(changed[0]), more: changed.length > 1 ? T('common.andMore', { n: changed.length - 1 }) : '' }));
        if (deleted.length) parts.push(T('snap.deletedCount', { n: deleted.length }));
        const sum = Object.values(delta).reduce((a, b) => a + b, 0);
        const words = sum ? T('snap.words', { n: sum > 0 ? `+${sum}` : `${sum}`, count: sum }) : '';
        return (parts.join(', ') || T('snap.default')) + words;
    }

    async history({ limit = 300, file } = {}) {
        const head = await this.head();
        if (!head) return [];
        let log;
        try {
            log = await git.log({ fs, gitdir: this.gitdir, ref: BRANCH, depth: limit });
        } catch (e) {
            return [];
        }
        const out = [];
        for (const entry of log) {
            const { title, note, meta } = parseMessage(entry.commit.message);
            const item = {
                oid: entry.oid,
                title,
                note,
                kind: meta.kind || 'auto',
                time: entry.commit.committer.timestamp * 1000,
                author: entry.commit.author.name,
                total: meta.total,
                delta: meta.delta || {},
                changed: meta.changed,
                deleted: meta.deleted || [],
                parents: entry.commit.parent
            };
            if (file) {
                const touched = (item.changed || []).includes(file) || item.deleted.includes(file);
                if (!touched && item.changed) continue;
            }
            out.push(item);
        }
        return out;
    }

    async commitChanges(oid) {
        const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid });
        const after = await this.treeFiles(oid);
        const before = await this.treeFiles(commit.parent[0] || null);
        const { meta } = parseMessage(commit.message);
        const d = this.diffMaps(before, after);
        const rows = [];
        for (const rel of d.added) rows.push({ rel, change: 'added' });
        for (const rel of d.modified) rows.push({ rel, change: 'modified' });
        for (const rel of d.deleted) rows.push({ rel, change: 'deleted' });
        return rows.map(r => ({ ...r, kind: docs.kindOf(r.rel), delta: (meta.delta || {})[r.rel] ?? null }));
    }

    async readAt(oid, rel) {
        if (oid === 'working') return fs.readFileSync(path.join(this.dir, ...rel.split('/')));
        const files = await this.treeFiles(oid);
        const blobOid = files.get(rel);
        if (!blobOid) return null;
        const { blob } = await git.readBlob({ fs, gitdir: this.gitdir, oid: blobOid });
        return Buffer.from(blob);
    }

    async parentOf(oid) {
        const { commit } = await git.readCommit({ fs, gitdir: this.gitdir, oid });
        return commit.parent[0] || null;
    }

    // Paragraf bazlı + paragraf içinde kelime bazlı karşılaştırma
    async diff(rel, fromOid, toOid) {
        const [a, b] = await Promise.all([
            fromOid ? this.readAt(fromOid, rel).catch(() => null) : null,
            this.readAt(toOid, rel).catch(() => null)
        ]);
        const kind = docs.kindOf(rel);
        const linesA = a ? await docs.extractLines(rel, a) : [];
        const linesB = b ? await docs.extractLines(rel, b) : [];
        if (linesA === null || linesB === null) return { supported: false, kind };
        const chunks = Diff.diffArrays(linesA, linesB);
        const blocks = [];
        let added = 0, removed = 0;
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const next = chunks[i + 1];
            if (c.removed && next && next.added) {
                const n = Math.max(c.value.length, next.value.length);
                for (let j = 0; j < n; j++) {
                    const oldP = c.value[j];
                    const newP = next.value[j];
                    if (oldP !== undefined && newP !== undefined) {
                        const parts = Diff.diffWordsWithSpace(oldP, newP).map(p => ({ t: p.value, a: !!p.added, r: !!p.removed }));
                        for (const p of parts) {
                            const w = docs.countWordsInLines([p.t]);
                            if (p.a) added += w;
                            if (p.r) removed += w;
                        }
                        blocks.push({ type: 'mod', parts });
                    } else if (newP !== undefined) {
                        added += docs.countWordsInLines([newP]);
                        blocks.push({ type: 'add', text: newP });
                    } else {
                        removed += docs.countWordsInLines([oldP]);
                        blocks.push({ type: 'del', text: oldP });
                    }
                }
                i++;
            } else if (c.added) {
                for (const t of c.value) blocks.push({ type: 'add', text: t });
                added += docs.countWordsInLines(c.value);
            } else if (c.removed) {
                for (const t of c.value) blocks.push({ type: 'del', text: t });
                removed += docs.countWordsInLines(c.value);
            } else {
                for (const t of c.value) blocks.push({ type: 'same', text: t });
            }
        }
        return { supported: true, kind, blocks, added, removed, existedBefore: !!a, existsAfter: !!b };
    }

    // Eski sürümü geri getirir. Önce mevcut hal kaydedilir; yani geri alma da geri alınabilir.
    async restore(rel, oid, mode) {
        const buf = await this.readAt(oid, rel);
        if (!buf) throw new Error(T('err.fileNotInVersion'));
        const when = new Date((await git.readCommit({ fs, gitdir: this.gitdir, oid })).commit.committer.timestamp * 1000);
        const stamp = when.toLocaleString('tr-TR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/:/g, '.');
        // Başlıkta görünen tarih arayüz dilinde; diske yazılan kopya adı değişmez (Türkçe)
        const label = I18N.getLanguage() === 'tr' ? stamp : when.toLocaleString(I18N.locale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const abs = path.join(this.dir, ...rel.split('/'));
        if (mode === 'copy') {
            const ext = path.extname(abs);
            const target = path.join(path.dirname(abs), `${path.basename(abs, ext)} (${stamp} sürümü)${ext}`);
            fs.writeFileSync(target, buf);
            return { path: target };
        }
        await this.snapshot({ kind: 'auto', title: T('snap.beforeRestore') });
        try {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, buf);
        } catch (e) {
            if (e.code === 'EBUSY' || e.code === 'EPERM') throw new Error(T('err.fileOpen'));
            throw e;
        }
        await this.snapshot({ kind: 'restore', title: T('snap.restored', { name: path.basename(rel), stamp: label }) });
        return { path: abs };
    }
}

module.exports = { Project, parseMessage, BRANCH, TRAILER };
