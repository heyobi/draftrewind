// "Aptal" depolar (Google Drive / iCloud / herhangi bir eşitlenen klasör) üzerinden git geçmişi eşitleme.
// Telefon motorundaki syncStoreNow ile AYNI düzen ve kurallar (mobile-expo/src/git/engine.js):
//   <proje klasörü>/.draftrewind/packs/pack-<sha>.pack : içerik adlı, değişmeyen git paketleri
//   <proje klasörü>/.draftrewind/heads/<cihaz>.json    : { head, time, device } — o cihazın son yayımı
// Her cihaz yalnızca kendi heads dosyasını yazar; paketler hiç değişmez. Paketi henüz görünmeyen uç
// (bulut gecikmesi) bir sonraki tura kalır; yarım yüklenmiş paket (ad ≠ son 20 bayt özeti) alınmaz.
// store: { id, list() → [ad], read(ad) → Buffer|null, write(ad, Buffer) }
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const { applyRemote, mergeDiverged } = require('./github');

const BRANCH = 'main';

function packLooksComplete(data, fileName) {
    if (!data) return false;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (bytes.length < 32 || bytes.subarray(0, 4).toString('latin1') !== 'PACK') return false;
    return fileName === `pack-${Buffer.from(bytes.subarray(bytes.length - 20)).toString('hex')}.pack`;
}

// Uzaktaki bir ucu yerele katar (github.sync ile aynı kurallar). Dönen: { local, pulled, conflicts }
async function integrate(project, local, remoteOid) {
    const gitdir = project.gitdir;
    if (!remoteOid || remoteOid === local) return { local, pulled: 0, conflicts: [] };
    if (!local) {
        const pulled = await applyRemote(project, null, remoteOid);
        await project.setHead(remoteOid);
        return { local: remoteOid, pulled, conflicts: [] };
    }
    const remoteAhead = await git.isDescendent({ fs, gitdir, oid: remoteOid, ancestor: local, depth: -1 });
    if (remoteAhead) {
        const pulled = await applyRemote(project, local, remoteOid);
        await project.setHead(remoteOid);
        return { local: remoteOid, pulled, conflicts: [] };
    }
    const localAhead = await git.isDescendent({ fs, gitdir, oid: local, ancestor: remoteOid, depth: -1 });
    if (localAhead) return { local, pulled: 0, conflicts: [] };
    const res = await mergeDiverged(project, local, remoteOid);
    return { local: res.oid, pulled: res.pulled, conflicts: res.conflicts };
}

// head'den ulaşılıp sınır kayıtlarından ulaşılamayan tüm nesneler (kayıt, ağaç, blob)
async function objectsSince(gitdir, head, boundary) {
    const readCommit = oid => git.readCommit({ fs, gitdir, oid }).then(r => r.commit);
    const stop = new Set();
    const stack = [...boundary];
    while (stack.length) {
        const oid = stack.pop();
        if (stop.has(oid)) continue;
        let c;
        try { c = await readCommit(oid); } catch (e) { continue; }
        stop.add(oid);
        for (const p of c.parent) stack.push(p);
    }
    const fresh = [];
    const seen = new Set();
    stack.push(head);
    while (stack.length) {
        const oid = stack.pop();
        if (stop.has(oid) || seen.has(oid)) continue;
        seen.add(oid);
        const c = await readCommit(oid);
        fresh.push({ oid, commit: c });
        for (const p of c.parent) stack.push(p);
    }
    const collect = async (treeOid, into, skip) => {
        if (into.has(treeOid) || (skip && skip.has(treeOid))) return;
        into.add(treeOid);
        const { tree } = await git.readTree({ fs, gitdir, oid: treeOid });
        for (const e of tree) {
            if (e.type === 'tree') await collect(e.oid, into, skip);
            else if (e.type === 'blob' && !(skip && skip.has(e.oid))) into.add(e.oid);
        }
    };
    const have = new Set();
    for (const { commit: c } of fresh) {
        for (const p of c.parent) {
            if (!stop.has(p)) continue;
            await collect((await readCommit(p)).tree, have, null);
        }
    }
    const out = new Set();
    for (const { oid, commit: c } of fresh) {
        out.add(oid);
        await collect(c.tree, out, have);
    }
    return [...out];
}

// Dönen: { pushed, pulled, conflicts, head, ahead, at }
// meta: uç dosyasına eklenen proje bilgisi (ör. { github: { owner, repo } }); dönen peers: diğer cihazlarınki
function syncStore(project, { store, deviceId, deviceName = '', noPush = false, meta = null }) {
    if (!store || !deviceId) throw new Error('store ve deviceId gerekli');
    return project.exclusive(async () => {
        const gitdir = project.gitdir;
        const stateFile = path.join(gitdir, 'draftrewind-stores.json');
        let all = {};
        try { all = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch (e) { all = {}; }
        const st = { imported: [], published: null, ...(all[store.id] || {}) };
        const imported = new Set(st.imported);
        const names = await store.list();
        const myHead = `heads/${deviceId}.json`;
        if (!names.includes(myHead)) st.published = null;

        // 1) Yeni paketler
        const packDir = path.join(gitdir, 'objects', 'pack');
        for (const name of names) {
            const m = /^packs\/(pack-[0-9a-f]{40}\.pack)$/.exec(name);
            if (!m || imported.has(name)) continue;
            const local = path.join(packDir, m[1]);
            if (!fs.existsSync(local.replace(/\.pack$/, '.idx'))) {
                const bytes = await store.read(name);
                if (!packLooksComplete(bytes, m[1])) continue;
                fs.mkdirSync(packDir, { recursive: true });
                const tmp = `${local}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, bytes);
                fs.renameSync(tmp, local);
                try {
                    await git.indexPack({ fs, dir: gitdir, gitdir, filepath: `objects/pack/${m[1]}` });
                } catch (e) {
                    try { fs.unlinkSync(local); } catch (err) {}
                    continue;
                }
            }
            imported.add(name);
        }

        // 2) Diğer cihazların uçları (eskiden yeniye)
        const heads = [];
        for (const name of names) {
            const m = /^heads\/(.+)\.json$/.exec(name);
            if (!m || m[1] === deviceId) continue;
            try {
                const h = JSON.parse(Buffer.from(await store.read(name)).toString('utf8'));
                if (h && /^[0-9a-f]{40}$/.test(h.head)) heads.push({ id: m[1], head: h.head, time: h.time || 0, github: h.github || null });
            } catch (e) {}
        }
        heads.sort((a, b) => a.time - b.time);
        let local = await project.head();
        let pulled = 0;
        let conflicts = [];
        const known = [];
        for (const h of heads) {
            try { await git.readCommit({ fs, gitdir, oid: h.head }); } catch (e) { continue; }
            known.push(h.head);
            if (h.head === local) continue;
            if (local && (await git.isDescendent({ fs, gitdir, oid: local, ancestor: h.head, depth: -1 }))) continue;
            const r = await integrate(project, local, h.head);
            local = r.local;
            pulled += r.pulled;
            conflicts = conflicts.concat(r.conflicts);
        }

        // 3) Yayımla
        let pushed = false;
        const metaKey = JSON.stringify(meta || {});
        if (local && !noPush && (local !== st.published || metaKey !== (st.meta || '{}'))) {
            const boundary = [...known, ...(st.published ? [st.published] : [])];
            const oids = await objectsSince(gitdir, local, boundary);
            if (oids.length) {
                const { filename, packfile } = await git.packObjects({ fs, gitdir, oids, write: false });
                await store.write(`packs/${filename}`, Buffer.from(packfile));
                imported.add(`packs/${filename}`);
            }
            await store.write(myHead, Buffer.from(JSON.stringify({ head: local, time: Date.now(), device: deviceName, ...(meta || {}) })));
            st.published = local;
            pushed = true;
        }
        if (pushed) st.meta = metaKey;
        all[store.id] = { imported: [...imported], published: st.published, meta: st.meta };
        const tmp = `${stateFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(all));
        fs.renameSync(tmp, stateFile);
        const peers = heads.map(x => ({ id: x.id, time: x.time, github: x.github }));
        return { pushed, pulled, conflicts, head: local || null, ahead: !!local && local !== st.published, at: Date.now(), peers };
    });
}

module.exports = { syncStore, objectsSince, packLooksComplete, integrate, BRANCH };
