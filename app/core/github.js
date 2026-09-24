// GitHub: cihaz kodu ile giriş + projeyi gizli depoya otomatik yedekleme.
// Sistemde git kurulu olması gerekmez (isomorphic-git HTTP istemcisi kullanılır).
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const config = require('./config');
const { BRANCH } = require('./engine');

const API = 'https://api.github.com';
const UA = 'DraftRewind-Desktop';

async function api(token, method, url, body) {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': UA,
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
}

async function startDeviceFlow() {
    const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: config.GITHUB_CLIENT_ID, scope: 'repo read:user' })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data; // device_code, user_code, verification_uri, interval, expires_in
}

// OAuth App'te "Expire user access tokens" açıksa jeton 8 saatte biter; yenileme jetonu 6 ay geçerlidir.
function sessionFrom(data) {
    return {
        token: data.access_token,
        refreshToken: data.refresh_token || null,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : null
    };
}

// Süresi dolmak üzereyse oturumu yeniler. Süresiz jetonlarda hiçbir şey yapmaz.
async function refreshIfNeeded(session) {
    if (!session || !session.expiresAt || !session.refreshToken) return session;
    if (Date.now() < session.expiresAt - 10 * 60 * 1000) return session;
    const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            client_id: config.GITHUB_CLIENT_ID,
            client_secret: config.GITHUB_CLIENT_SECRET,
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken
        })
    });
    const data = await res.json();
    if (!data.access_token) throw Object.assign(new Error(T('err.ghAuth')), { auth: true });
    return sessionFrom(data);
}

// Kullanıcı tarayıcıda onaylayana kadar bekler. cancelToken.cancelled = true ile durdurulur.
async function waitForToken(flow, cancelToken) {
    let interval = (flow.interval || 5) * 1000;
    const deadline = Date.now() + (flow.expires_in || 900) * 1000;
    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, interval));
        if (cancelToken.cancelled) throw new Error(T('err.cancelled'));
        const res = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                client_id: config.GITHUB_CLIENT_ID,
                device_code: flow.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            })
        }).catch(() => null);
        if (!res) continue; // bağlantı koptu, tekrar dene
        const data = await res.json();
        if (data.access_token) return sessionFrom(data);
        if (data.error === 'slow_down') interval += 5000;
        else if (data.error === 'authorization_pending') continue;
        else if (data.error === 'access_denied') throw new Error(T('err.ghDenied'));
        else if (data.error === 'expired_token') throw new Error(T('err.ghExpired'));
        else if (data.error) throw new Error(data.error_description || data.error);
    }
    throw new Error(T('err.ghExpired'));
}

async function getUser(token) {
    const r = await api(token, 'GET', '/user');
    if (!r.ok) throw new Error(T('err.ghUser'));
    return { login: r.data.login, name: r.data.name || r.data.login, avatar: r.data.avatar_url, url: r.data.html_url, email: r.data.email };
}

function slugify(name) {
    const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
    return (
        String(name)
            .replace(/[çğıöşüÇĞİÖŞÜ]/g, c => map[c])
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60) || 'tez'
    );
}

// Proje için gizli depo oluşturur (varsa aynısını kullanır). Mobil uygulama "draftrewind" etiketine bakar.
async function ensureRepo(token, user, project) {
    if (project.github && project.github.owner && project.github.repo) {
        const r = await api(token, 'GET', `/repos/${project.github.owner}/${project.github.repo}`);
        if (r.ok) return project.github;
    }
    const base = `draftrewind-${slugify(project.name)}`;
    for (let i = 0; i < 20; i++) {
        const name = i === 0 ? base : `${base}-${i + 1}`;
        const r = await api(token, 'POST', '/user/repos', {
            name,
            private: true,
            auto_init: false,
            description: `${project.name} — DraftRewind ile otomatik yedeklenir`
        });
        if (r.ok) {
            await api(token, 'PUT', `/repos/${r.data.full_name}/topics`, { names: ['draftrewind', 'acadamiv'] });
            return { owner: r.data.owner.login, repo: r.data.name, url: r.data.html_url };
        }
        if (r.status !== 422) throw new Error((r.data && r.data.message) || T('err.ghRepo'));
    }
    throw new Error(T('err.ghRepoName'));
}

function onAuth(token) {
    return () => ({ username: token, password: 'x-oauth-basic' });
}

// Eşitleme: yereldeki hiçbir şey kaybolmaz. İki bilgisayarda aynı dosya farklı değiştiyse
// yerel sürüm kalır, diğeri "(diğer cihazdan)" kopyası olarak klasöre eklenir.
async function sync(project, token) {
    const { owner, repo } = project.meta.github;
    const url = `https://github.com/${owner}/${repo}.git`;
    const gitdir = project.gitdir;
    await git.addRemote({ fs, gitdir, remote: 'origin', url, force: true });

    return project.exclusive(async () => {
        let remoteOid = null;
        try {
            await git.fetch({ fs, http, gitdir, url, remote: 'origin', ref: BRANCH, singleBranch: true, tags: false, onAuth: onAuth(token) });
            remoteOid = await git.resolveRef({ fs, gitdir, ref: `refs/remotes/origin/${BRANCH}` });
        } catch (e) {
            // Boş depo (henüz hiç gönderilmemiş) → sadece göndereceğiz
            if (!/Could not find|NotFoundError|empty|couldn't find remote ref/i.test(String(e.message || e.code))) {
                if (/401|403|Unauthorized|HttpError/i.test(String(e.message))) throw new Error(T('err.ghAuth'));
                throw e;
            }
        }

        let local = await project.head();
        let pulled = 0, conflicts = [];

        if (remoteOid && local && remoteOid !== local) {
            const remoteAhead = await git.isDescendent({ fs, gitdir, oid: remoteOid, ancestor: local, depth: -1 });
            const localAhead = !remoteAhead && (await git.isDescendent({ fs, gitdir, oid: local, ancestor: remoteOid, depth: -1 }));
            if (remoteAhead) {
                pulled = await applyRemote(project, local, remoteOid);
                await project.setHead(remoteOid);
                local = remoteOid;
            } else if (!localAhead) {
                const res = await mergeDiverged(project, local, remoteOid);
                pulled = res.pulled;
                conflicts = res.conflicts;
                local = res.oid;
            }
        } else if (remoteOid && !local) {
            pulled = await applyRemote(project, null, remoteOid);
            await project.setHead(remoteOid);
            local = remoteOid;
        }

        if (local && local !== remoteOid) {
            const r = await git.push({ fs, http, gitdir, url, remote: 'origin', ref: BRANCH, remoteRef: BRANCH, onAuth: onAuth(token) });
            if (r && r.ok === false) throw new Error(T('err.ghPush'));
        }
        return { pushed: local !== remoteOid, pulled, conflicts, at: Date.now() };
    });
}

function writeWorkingFile(project, rel, buf) {
    const abs = path.join(project.dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
}

function conflictName(rel) {
    const ext = path.extname(rel);
    return `${rel.slice(0, rel.length - ext.length)} (diğer cihazdan)${ext}`;
}

// Uzak kayıt yerelin devamıysa: sadece değişen dosyaları klasöre yaz.
async function applyRemote(project, localOid, remoteOid) {
    const before = await project.treeFiles(localOid);
    const after = await project.treeFiles(remoteOid);
    let n = 0;
    for (const [rel, oid] of after) {
        if (before.get(rel) === oid) continue;
        const { blob } = await git.readBlob({ fs, gitdir: project.gitdir, oid });
        try {
            writeWorkingFile(project, rel, Buffer.from(blob));
        } catch (e) {
            // Dosya açık/kilitli: yanına kopya bırak
            writeWorkingFile(project, conflictName(rel), Buffer.from(blob));
        }
        n++;
    }
    for (const rel of before.keys()) {
        if (!after.has(rel)) {
            try { fs.unlinkSync(path.join(project.dir, ...rel.split('/'))); } catch (e) {}
        }
    }
    return n;
}

async function mergeDiverged(project, localOid, remoteOid) {
    const gitdir = project.gitdir;
    const [baseOid] = await git.findMergeBase({ fs, gitdir, oids: [localOid, remoteOid] });
    const base = await project.treeFiles(baseOid || null);
    const mine = await project.treeFiles(localOid);
    const theirs = await project.treeFiles(remoteOid);
    const result = new Map(mine);
    const conflicts = [];
    let pulled = 0;
    const all = new Set([...base.keys(), ...mine.keys(), ...theirs.keys()]);
    for (const rel of all) {
        const b = base.get(rel), m = mine.get(rel), t = theirs.get(rel);
        if (m === t || t === b) continue; // diğer taraf değiştirmemiş
        if (m === b) {
            // Sadece diğer cihaz değiştirmiş → onu al
            if (t) {
                const { blob } = await git.readBlob({ fs, gitdir, oid: t });
                writeWorkingFile(project, rel, Buffer.from(blob));
                result.set(rel, t);
            } else {
                try { fs.unlinkSync(path.join(project.dir, ...rel.split('/'))); } catch (e) {}
                result.delete(rel);
            }
            pulled++;
            continue;
        }
        // İki taraf da değiştirmiş: yerel kalsın, diğeri kopya olarak eklensin
        if (t) {
            const copy = conflictName(rel);
            const { blob } = await git.readBlob({ fs, gitdir, oid: t });
            writeWorkingFile(project, copy, Buffer.from(blob));
            result.set(copy, t);
            conflicts.push(copy);
        }
    }
    const treeOid = await project.writeTreeFromMap(result);
    const d = new Date();
    const who = { name: 'DraftRewind', email: 'kayit@draftrewind.local', timestamp: Math.floor(d / 1000), timezoneOffset: d.getTimezoneOffset() };
    const prevMeta = await project.lastMeta(localOid);
    const meta = { v: 1, kind: 'merge', total: prevMeta.total, words: prevMeta.words, delta: {}, changed: conflicts, deleted: [] };
    const title = conflicts.length
        ? T('snap.ghMerged', { n: conflicts.length })
        : T('snap.ghPulled');
    const oid = await git.writeCommit({
        fs,
        gitdir,
        commit: { message: `${title}\n\nacadamiv: ${JSON.stringify(meta)}\n`, tree: treeOid, parent: [localOid, remoteOid], author: who, committer: who }
    });
    await project.setHead(oid);
    // Karma çalışma klasörü için önbellek tazelensin
    project.hashCache = {};
    return { oid, pulled, conflicts };
}

module.exports = { startDeviceFlow, waitForToken, refreshIfNeeded, getUser, ensureRepo, sync, api };
