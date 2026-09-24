// Geçmişin disk kullanımı: her kayıt noktası değişen belgenin tam kopyasını saklar (docx zaten
// sıkıştırılmış olduğu için küçülmez). Aylar içinde onlarca GB'a çıkmasın diye eski otomatik
// kayıtlar seyreltilir: son 7 gün tümü, sonraki 60 gün günde bir, daha eskisi haftada bir.
// İşaretlenen anlar, kurtarmalar, geri dönüşler, birleştirmeler ve telefondan gelenler hep kalır.
// Seyreltme geçmişi yeniden yazar (aynı ağaçlar, aynı tarih/mesajlar; yalnızca zincir kısalır),
// sonra ulaşılamayan gevşek nesneler silinir. GitHub'a zorla gönderilir; diğer bilgisayar
// gönderilmemiş kaydı yoksa yeni zinciri olduğu gibi benimser (github.js).
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const { BRANCH, parseMessage, TRAILER } = require('./engine');

const KEEP_KINDS = new Set(['star', 'rescue', 'restore', 'merge', 'mobile']);
const DAY = 24 * 3600 * 1000;

// Klasör boyutu (gitdir). Paket dosyaları da sayılır.
function dirSize(dir) {
    let total = 0;
    let files = 0;
    const walk = d => {
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const e of entries) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) {
                try {
                    total += fs.statSync(p).size;
                    files++;
                } catch (err) {}
            }
        }
    };
    walk(dir);
    return { bytes: total, files };
}

function historySize(project) {
    return dirSize(path.join(project.gitdir, 'objects'));
}

// Proje eklenirken hızlı bakış: dosya sayısı ve toplam boyut (sınıra gelince durur)
function quickFolderStats(dir, { maxFiles = 4000, maxBytes = 8 * 1024 * 1024 * 1024 } = {}) {
    const SKIP = new Set(['.git', 'node_modules', '$recycle.bin', 'system volume information', 'appdata', 'library']);
    let files = 0;
    let bytes = 0;
    let capped = false;
    const walk = d => {
        if (capped) return;
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const e of entries) {
            if (capped) return;
            if (e.isDirectory()) {
                if (SKIP.has(e.name.toLowerCase()) || e.name.startsWith('.')) continue;
                walk(path.join(d, e.name));
            } else if (e.isFile()) {
                files++;
                try {
                    bytes += fs.statSync(path.join(d, e.name)).size;
                } catch (err) {}
                if (files >= maxFiles || bytes >= maxBytes) capped = true;
            }
        }
    };
    walk(dir);
    return { files, bytes, capped };
}

// İlk-ebeveyn zinciri (yeniden eskiye)
async function chain(project) {
    const out = [];
    let oid = await project.head();
    const seen = new Set();
    while (oid && !seen.has(oid)) {
        seen.add(oid);
        const { commit } = await git.readCommit({ fs, gitdir: project.gitdir, oid });
        out.push({ oid, commit });
        oid = commit.parent[0] || null;
    }
    return out;
}

// Hangi kayıtlar kalacak? (yeniden eskiye sıralı zincir)
function selectKeep(list, { now = Date.now(), keepAllMs = 7 * DAY, dailyMs = 60 * DAY } = {}) {
    const keep = new Set();
    const dayKey = t => Math.floor(t / DAY);
    const weekKey = t => Math.floor(t / (7 * DAY));
    const seenDay = new Set();
    const seenWeek = new Set();
    list.forEach((c, i) => {
        const t = c.commit.committer.timestamp * 1000;
        const { meta } = parseMessage(c.commit.message);
        const kind = meta.kind || 'auto';
        const age = now - t;
        // Zincir yeniden eskiye gittiği için ilk görülen = o günün/haftanın SON kaydı
        const key = age < dailyMs ? `d${dayKey(t)}` : `w${weekKey(t)}`;
        const seen = age < dailyMs ? seenDay : seenWeek;
        if (i === 0 || KEEP_KINDS.has(kind) || c.commit.parent.length > 1 || age < keepAllMs) {
            keep.add(c.oid);
            seen.add(key); // o gün/hafta zaten temsil ediliyor
            return;
        }
        if (!seen.has(key)) {
            seen.add(key);
            keep.add(c.oid);
        }
    });
    return keep;
}

// Geçmişi seyreltir. Dönen: { removed, kept, head } (removed 0 ise hiçbir şey yazılmaz)
async function thinHistory(project, opts = {}) {
    return project.exclusive(async () => {
        const list = await chain(project);
        if (list.length < 3) return { removed: 0, kept: list.length, head: await project.head() };
        const keep = selectKeep(list, opts);
        const kept = list.filter(c => keep.has(c.oid)).reverse(); // eskiden yeniye
        const removed = list.length - kept.length;
        if (!removed) return { removed: 0, kept: kept.length, head: list[0].oid };
        let parent = null;
        let newHead = null;
        for (const c of kept) {
            // Ağaç, mesaj ve zaman damgaları aynı; yalnızca ebeveyn yeni zincire bağlanır
            const commit = { ...c.commit, parent: parent ? [parent] : [] };
            newHead = await git.writeCommit({ fs, gitdir: project.gitdir, commit });
            parent = newHead;
        }
        await project.setHead(newHead);
        project.treeCache.clear();
        project.wordsCache = null;
        // Eski uzak referansı yeni zinciri işaret etmiyor; sonraki fetch yeniden yazar
        try { fs.unlinkSync(path.join(project.gitdir, 'refs', 'remotes', 'origin', BRANCH)); } catch (e) {}
        await pruneUnreachable(project);
        return { removed, kept: kept.length, head: newHead };
    });
}

// Yeni baştan ulaşılamayan gevşek nesneleri siler (paketlere dokunmaz).
async function pruneUnreachable(project) {
    const gitdir = project.gitdir;
    const reachable = new Set();
    const trees = new Set();
    const walkTree = async oid => {
        if (trees.has(oid)) return;
        trees.add(oid);
        reachable.add(oid);
        const { tree } = await git.readTree({ fs, gitdir, oid });
        for (const e of tree) {
            if (e.type === 'tree') await walkTree(e.oid);
            else reachable.add(e.oid);
        }
    };
    const stack = [await project.head()];
    while (stack.length) {
        const oid = stack.pop();
        if (!oid || reachable.has(oid)) continue;
        reachable.add(oid);
        let commit;
        try {
            ({ commit } = await git.readCommit({ fs, gitdir, oid }));
        } catch (e) {
            continue;
        }
        await walkTree(commit.tree);
        for (const p of commit.parent) stack.push(p);
    }
    const objDir = path.join(gitdir, 'objects');
    let deleted = 0;
    let dirs = [];
    try {
        dirs = fs.readdirSync(objDir).filter(n => /^[0-9a-f]{2}$/.test(n));
    } catch (e) {
        return 0;
    }
    for (const d of dirs) {
        const full = path.join(objDir, d);
        let names = [];
        try {
            names = fs.readdirSync(full);
        } catch (e) {
            continue;
        }
        for (const n of names) {
            if (!/^[0-9a-f]{38}$/.test(n) || reachable.has(d + n)) continue;
            try {
                fs.unlinkSync(path.join(full, n));
                deleted++;
            } catch (e) {}
        }
        try {
            if (!fs.readdirSync(full).length) fs.rmdirSync(full);
        } catch (e) {}
    }
    return deleted;
}

module.exports = { thinHistory, pruneUnreachable, historySize, quickFolderStats, selectKeep, dirSize, TRAILER };
