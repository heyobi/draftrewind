// Google Drive ile ÇİFT YÖNLÜ eşitleme. İki yol:
//  1) "Klasör" modu: Bilgisayardaki Google Drive (veya OneDrive) klasörü kullanılır; giriş gerekmez.
//  2) "Hesap" modu: Google ile giriş (drive.file: sadece bu uygulamanın oluşturduğu dosyalara erişim).
// Drive'da yapı: DraftRewind/<Proje>/...dosyalar...  ve  DraftRewind/<Proje>/_Sürümler/<tarih> <dosya>
//
// Çakışmasızlık: her dosyanın "en son eşitlenen hali"nin md5'i saklanır (base).
//   yalnız Drive değişti → bilgisayara indir · yalnız bilgisayar değişti → Drive'a yükle
//   ikisi de değişti → hiçbiri ezilmez: Drive'daki hali "(Drive'dan)" kopyası olarak eklenir.
// Aynı isimli projeler: her proje klasörü proje kimliğiyle işaretlenir; isim doluysa "(2)" eklenir.
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const config = require('./config');

const ROOT_NAME = 'DraftRewind';
const VERSIONS = '_Sürümler';
const MARKER = '.draftrewind-proje.json';
const MIME = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg'
};
const IGNORE = /^(~\$|~wrl|\.~lock\.|desktop\.ini$|thumbs\.db$|\.)/i;

const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

function safeName(s) {
    return String(s).replace(/[<>:"/\\|?*]/g, '-').trim();
}

function stamp(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
}

function copyName(rel, label) {
    const ext = path.extname(rel);
    return `${rel.slice(0, rel.length - ext.length)} (${label})${ext}`;
}

function versionName(rel, kind, suffix = '') {
    const ext = path.extname(rel);
    const base = path.basename(rel, ext);
    return safeName(`${stamp()} ${base}${kind === 'star' ? ' ⭐' : ''}${suffix}${ext}`);
}

// ---------------------------------------------------------------------------
// Bilgisayardaki bulut klasörlerini bul (sürücü taraması yavaş olabilir: 1 dk önbellek)
// ---------------------------------------------------------------------------
let detectCache = { at: 0, list: [] };
function detectFolders() {
    if (Date.now() - detectCache.at < 60 * 1000) return detectCache.list;
    detectCache = { at: Date.now(), list: detectFoldersNow() };
    return detectCache.list;
}

function detectFoldersNow() {
    const found = [];
    const add = (p, label, kind) => {
        try {
            if (p && fs.existsSync(p) && fs.statSync(p).isDirectory() && !found.some(f => f.path.toLowerCase() === p.toLowerCase())) {
                found.push({ path: p, label, kind });
            }
        } catch (e) {}
    };
    const driveNames = ['My Drive', "Drive'ım", 'Drive’ım', 'Meine Ablage', 'Mon Drive', 'Mi unidad'];
    if (process.platform === 'win32') {
        for (let c = 68; c <= 90; c++) {
            const letter = String.fromCharCode(c) + ':\\';
            for (const n of driveNames) add(path.join(letter, n), `Google Drive (${letter.slice(0, 2)})`, 'gdrive');
        }
    }
    const home = os.homedir();
    for (const n of driveNames) add(path.join(home, 'Google Drive', n), 'Google Drive', 'gdrive');
    add(path.join(home, 'Google Drive'), 'Google Drive', 'gdrive');
    add(path.join(home, 'My Drive'), 'Google Drive', 'gdrive');
    if (process.platform === 'darwin') {
        const cloud = path.join(home, 'Library', 'CloudStorage');
        try {
            for (const d of fs.readdirSync(cloud)) {
                if (d.startsWith('GoogleDrive')) for (const n of driveNames) add(path.join(cloud, d, n), 'Google Drive', 'gdrive');
            }
        } catch (e) {}
    }
    add(process.env.OneDrive, 'OneDrive', 'onedrive');
    add(process.env.OneDriveConsumer, 'OneDrive', 'onedrive');
    add(process.env.OneDriveCommercial, 'OneDrive (Kurum)', 'onedrive');
    return found;
}

// ---------------------------------------------------------------------------
// Klasör modu (Drive masaüstü uygulamasının klasörü)
// ---------------------------------------------------------------------------
class FolderRemote {
    constructor(root) {
        this.root = root;
        this.md5Cache = {};
    }

    // Projeye ait klasörü bul/oluştur. Aynı isimde başka projenin klasörü varsa "(2)" ekle.
    async prepare(project, record) {
        const base = path.join(this.root, ROOT_NAME);
        const mine = dir => {
            try {
                return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8')).id === project.id;
            } catch (e) {
                return false;
            }
        };
        if (record.driveFolderName && mine(path.join(base, record.driveFolderName))) {
            this.dir = path.join(base, record.driveFolderName);
        } else {
            const name = safeName(project.name);
            for (let i = 1; i < 100; i++) {
                const candidate = i === 1 ? name : `${name} (${i})`;
                const dir = path.join(base, candidate);
                if (fs.existsSync(dir) && !mine(dir)) continue;
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ id: project.id, name: project.name, note: 'DraftRewind bu klasörü eşitliyor. Bu dosyayı silmeyin.' }));
                try { require('child_process').execFile('attrib', ['+h', path.join(dir, MARKER)], { windowsHide: true }, () => {}); } catch (e) {}
                record.driveFolderName = candidate;
                this.dir = dir;
                break;
            }
        }
        return { url: this.dir };
    }

    async list() {
        const out = new Map();
        const walk = (abs, rel) => {
            let entries = [];
            try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
            for (const e of entries) {
                if (IGNORE.test(e.name)) continue;
                const r = rel ? `${rel}/${e.name}` : e.name;
                if (e.isDirectory()) {
                    if (!rel && e.name === VERSIONS) continue;
                    walk(path.join(abs, e.name), r);
                } else if (e.isFile()) {
                    const full = path.join(abs, e.name);
                    try {
                        const st = fs.statSync(full);
                        if (st.size > config.MAX_FILE_BYTES) continue;
                        const c = this.md5Cache[r];
                        let sum = c && c.m === st.mtimeMs && c.s === st.size ? c.md5 : null;
                        if (!sum) {
                            sum = md5(fs.readFileSync(full));
                            this.md5Cache[r] = { m: st.mtimeMs, s: st.size, md5: sum };
                        }
                        out.set(r, { md5: sum });
                    } catch (err) {}
                }
            }
        };
        walk(this.dir, '');
        return out;
    }

    abs(rel) {
        return path.join(this.dir, ...rel.split('/'));
    }

    async read(rel) {
        return fs.readFileSync(this.abs(rel));
    }

    async write(rel, buf) {
        fs.mkdirSync(path.dirname(this.abs(rel)), { recursive: true });
        fs.writeFileSync(this.abs(rel), buf);
        return md5(buf);
    }

    async archive(rel) {
        const vDir = path.join(this.dir, VERSIONS, ...rel.split('/').slice(0, -1));
        fs.mkdirSync(vDir, { recursive: true });
        fs.renameSync(this.abs(rel), path.join(vDir, versionName(rel, 'auto', ' (silindi)')));
    }

    async version(rel, buf, kind) {
        const vDir = path.join(this.dir, VERSIONS, ...rel.split('/').slice(0, -1));
        fs.mkdirSync(vDir, { recursive: true });
        fs.writeFileSync(path.join(vDir, versionName(rel, kind)), buf);
    }
}

// ---------------------------------------------------------------------------
// Hesap modu (Google OAuth + Drive API)
// ---------------------------------------------------------------------------
function b64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signIn(openExternal) {
    if (!config.GOOGLE_CLIENT_ID) return Promise.reject(new Error(T('err.googleNotConfigured')));
    return new Promise((resolve, reject) => {
        const verifier = b64url(crypto.randomBytes(32));
        const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
        const stateToken = b64url(crypto.randomBytes(16));
        const srv = http.createServer();
        let done = false;
        const finish = (err, val) => {
            if (done) return;
            done = true;
            try { srv.close(); } catch (e) {}
            err ? reject(err) : resolve(val);
        };
        srv.listen(0, '127.0.0.1', () => {
            const redirectUri = `http://127.0.0.1:${srv.address().port}`;
            const url =
                'https://accounts.google.com/o/oauth2/v2/auth?' +
                new URLSearchParams({
                    client_id: config.GOOGLE_CLIENT_ID,
                    redirect_uri: redirectUri,
                    response_type: 'code',
                    scope: 'https://www.googleapis.com/auth/drive.file openid email profile',
                    access_type: 'offline',
                    prompt: 'consent',
                    code_challenge: challenge,
                    code_challenge_method: 'S256',
                    state: stateToken
                });
            srv.on('request', async (req, res) => {
                const u = new URL(req.url, redirectUri);
                if (u.pathname !== '/') {
                    res.writeHead(404);
                    return res.end();
                }
                const code = u.searchParams.get('code');
                const ok = code && u.searchParams.get('state') === stateToken;
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(resultPage(ok));
                if (!ok) return finish(new Error(T('err.googleCancelled')));
                try {
                    const params = { code, client_id: config.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier };
                    if (config.GOOGLE_CLIENT_SECRET) params.client_secret = config.GOOGLE_CLIENT_SECRET;
                    const tr = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams(params)
                    });
                    const tokens = await tr.json();
                    if (!tokens.access_token) throw new Error(tokens.error_description || tokens.error || T('err.googleToken'));
                    tokens.expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;
                    const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
                    const u2 = ur.ok ? await ur.json() : {};
                    finish(null, { tokens, user: { name: u2.name || u2.email, email: u2.email, picture: u2.picture } });
                } catch (e) {
                    finish(e);
                }
            });
            openExternal(url);
        });
        setTimeout(() => finish(new Error(T('err.googleTimeout'))), 3 * 60 * 1000);
    });
}

function resultPage(ok) {
    return `<!doctype html><html lang="${I18N.getLanguage()}"><meta charset="utf-8"><title>DraftRewind</title>
<body style="font-family:Segoe UI,system-ui,sans-serif;background:#f6f5ff;display:grid;place-items:center;height:100vh;margin:0">
<div style="background:#fff;padding:40px 48px;border-radius:24px;text-align:center;box-shadow:0 20px 60px rgba(80,60,200,.15)">
<div style="font-size:56px">${ok ? '🎉' : '😕'}</div>
<h2 style="margin:8px 0;color:#1e1b4b">${ok ? T('oauth.okTitle') : T('oauth.failTitle')}</h2>
<p style="color:#64748b">${ok ? T('oauth.okText') : T('oauth.failText')}</p></div></body>`;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

class DriveApi {
    constructor(getTokens, saveTokens) {
        this.getTokens = getTokens;
        this.saveTokens = saveTokens;
    }

    async token() {
        const t = this.getTokens();
        if (!t) throw new Error(T('err.driveNotConnected'));
        if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
        if (!t.refresh_token) return t.access_token;
        const params = { client_id: config.GOOGLE_CLIENT_ID, refresh_token: t.refresh_token, grant_type: 'refresh_token' };
        if (config.GOOGLE_CLIENT_SECRET) params.client_secret = config.GOOGLE_CLIENT_SECRET;
        const r = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params)
        });
        const d = await r.json();
        if (!d.access_token) throw new Error(T('err.driveRefresh'));
        const next = { ...t, access_token: d.access_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
        this.saveTokens(next);
        return next.access_token;
    }

    async req(method, url, { headers, body, raw } = {}) {
        const tk = await this.token();
        const r = await fetch(url, { method, headers: { Authorization: `Bearer ${tk}`, ...(headers || {}) }, body });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(T('err.driveHttp', { status: r.status }));
        if (raw) return Buffer.from(await r.arrayBuffer());
        return r.status === 204 ? {} : r.json();
    }

    esc(s) {
        return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    async query(q, fields = 'files(id,name,mimeType,md5Checksum,parents,webViewLink,appProperties)') {
        const out = [];
        let pageToken = '';
        do {
            const d = await this.req('GET', `https://www.googleapis.com/drive/v3/files?pageSize=1000&fields=nextPageToken,${fields}&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`);
            out.push(...d.files);
            pageToken = d.nextPageToken || '';
        } while (pageToken);
        return out;
    }

    async createFolder(name, parentId, appProperties) {
        return this.req('POST', 'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink', {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties })
        });
    }

    async upload({ id, name, parentId, buf }) {
        const mime = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
        if (id) {
            return this.req('PATCH', `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,md5Checksum`, {
                headers: { 'Content-Type': mime },
                body: buf
            });
        }
        const boundary = 'draftrewind' + crypto.randomBytes(8).toString('hex');
        const meta = JSON.stringify({ name, parents: [parentId] });
        const body = Buffer.concat([
            Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
            buf,
            Buffer.from(`\r\n--${boundary}--`)
        ]);
        return this.req('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum', {
            headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
            body
        });
    }
}

class ApiRemote {
    constructor(api) {
        this.api = api;
        this.files = new Map(); // rel → { id, md5, parent }
        this.dirs = new Map(); // rel dir ('' = proje kökü) → id
    }

    async rootFolder() {
        const found = await this.api.query(`mimeType='${FOLDER_MIME}' and trashed=false and name='${ROOT_NAME}' and 'root' in parents`);
        return found[0] || (await this.api.createFolder(ROOT_NAME, null));
    }

    // Projeye ait klasör: önce kayıtlı kimlik, sonra proje kimliği etiketi; yoksa benzersiz adla oluştur.
    async prepare(project, record) {
        let folder = null;
        if (record.driveFolderId) {
            folder = await this.api.req('GET', `https://www.googleapis.com/drive/v3/files/${record.driveFolderId}?fields=id,name,trashed,webViewLink`);
            if (folder && folder.trashed) folder = null;
        }
        if (!folder) {
            const tagged = await this.api.query(`mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='draftrewindId' and value='${this.api.esc(project.id)}' }`);
            folder = tagged[0] || null;
        }
        if (!folder) {
            const root = await this.rootFolder();
            const siblings = new Set((await this.api.query(`'${root.id}' in parents and trashed=false and mimeType='${FOLDER_MIME}'`, 'files(name)')).map(f => f.name));
            const name = safeName(project.name);
            let candidate = name;
            for (let i = 2; siblings.has(candidate); i++) candidate = `${name} (${i})`;
            folder = await this.api.createFolder(candidate, root.id, { draftrewindId: project.id });
        }
        record.driveFolderId = folder.id;
        this.folderId = folder.id;
        return { url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}` };
    }

    async list() {
        this.files = new Map();
        this.dirs = new Map([['', this.folderId]]);
        const out = new Map();
        const queue = [['', this.folderId]];
        while (queue.length) {
            const [rel, id] = queue.shift();
            for (const f of await this.api.query(`'${id}' in parents and trashed=false`)) {
                if (IGNORE.test(f.name)) continue;
                const r = rel ? `${rel}/${f.name}` : f.name;
                if (f.mimeType === FOLDER_MIME) {
                    if (!rel && f.name === VERSIONS) {
                        this.dirs.set(VERSIONS, f.id);
                        continue;
                    }
                    this.dirs.set(r, f.id);
                    queue.push([r, f.id]);
                } else if (f.md5Checksum) {
                    // Google Dokümanlar biçimindeki dosyaların md5'i yok; bunlar bizim değil, atla
                    this.files.set(r, { id: f.id, md5: f.md5Checksum, parent: id });
                    out.set(r, { md5: f.md5Checksum });
                }
            }
        }
        return out;
    }

    async dirId(relDir) {
        if (this.dirs.has(relDir)) return this.dirs.get(relDir);
        const parts = relDir.split('/');
        const parent = await this.dirId(parts.slice(0, -1).join('/'));
        const f = await this.api.createFolder(parts[parts.length - 1], parent);
        this.dirs.set(relDir, f.id);
        return f.id;
    }

    async read(rel) {
        return this.api.req('GET', `https://www.googleapis.com/drive/v3/files/${this.files.get(rel).id}?alt=media`, { raw: true });
    }

    async write(rel, buf) {
        const existing = this.files.get(rel);
        const r = await this.api.upload({
            id: existing && existing.id,
            name: rel.split('/').pop(),
            parentId: await this.dirId(rel.split('/').slice(0, -1).join('/')),
            buf
        });
        this.files.set(rel, { id: r.id, md5: r.md5Checksum, parent: existing && existing.parent });
        return r.md5Checksum || md5(buf);
    }

    async versionDir(rel) {
        const dirs = rel.split('/').slice(0, -1);
        return this.dirId([VERSIONS, ...dirs].join('/'));
    }

    async archive(rel) {
        const f = this.files.get(rel);
        const target = await this.versionDir(rel);
        await this.api.req('PATCH', `https://www.googleapis.com/drive/v3/files/${f.id}?addParents=${target}&removeParents=${f.parent}&fields=id`, {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: versionName(rel, 'auto', ' (silindi)') })
        });
        this.files.delete(rel);
    }

    async version(rel, buf, kind) {
        await this.api.upload({ name: versionName(rel, kind), parentId: await this.versionDir(rel), buf });
    }
}

// ---------------------------------------------------------------------------
// Eşitleme
// ---------------------------------------------------------------------------
function shouldVersion(state, rel, kind) {
    state.versionTimes = state.versionTimes || {};
    const last = state.versionTimes[rel] || 0;
    if (kind === 'star' || Date.now() - last >= config.DRIVE_VERSION_EVERY_MS) {
        state.versionTimes[rel] = Date.now();
        return true;
    }
    return false;
}

// project: engine Project · remote: FolderRemote|ApiRemote · state: { base, versionTimes } (kalıcı)
async function reconcile(project, remote, state, kind = 'auto') {
    state.base = state.base || {};
    project.md5Cache = project.md5Cache || {};
    const base = state.base;
    const localFiles = project.scanWorkingFiles();
    const local = new Map();
    for (const [rel, f] of localFiles) {
        const c = project.md5Cache[rel];
        if (c && c.m === f.mtimeMs && c.s === f.size) {
            local.set(rel, c.md5);
            continue;
        }
        try {
            const sum = md5(fs.readFileSync(f.abs));
            project.md5Cache[rel] = { m: f.mtimeMs, s: f.size, md5: sum };
            local.set(rel, sum);
        } catch (e) {
            // Kilitli dosya: bu turda bu dosyaya dokunma
            if (base[rel]) local.set(rel, base[rel]);
        }
    }
    const remoteFiles = await remote.list();
    const result = { uploaded: [], downloaded: [], conflicts: [], archived: [] };
    const localAbs = rel => path.join(project.dir, ...rel.split('/'));
    const readLocal = rel => fs.readFileSync(localAbs(rel));
    const writeLocal = (rel, buf) => {
        fs.mkdirSync(path.dirname(localAbs(rel)), { recursive: true });
        try {
            fs.writeFileSync(localAbs(rel), buf);
            return rel;
        } catch (e) {
            // Dosya Word'de açık: üzerine yazma, yanına koy
            const alt = copyName(rel, "Drive'dan");
            fs.writeFileSync(localAbs(alt), buf);
            return alt;
        }
    };
    const upload = async (rel, versionKind) => {
        const buf = readLocal(rel);
        base[rel] = await remote.write(rel, buf);
        if (versionKind && shouldVersion(state, rel, versionKind)) await remote.version(rel, buf, versionKind);
        result.uploaded.push(rel);
    };
    const download = async rel => {
        const buf = await remote.read(rel);
        const written = writeLocal(rel, buf);
        base[rel] = md5(buf);
        if (written !== rel) result.conflicts.push(written);
        result.downloaded.push(written);
    };

    const all = new Set([...local.keys(), ...remoteFiles.keys()]);
    for (const rel of all) {
        const L = local.get(rel) || null;
        const R = remoteFiles.has(rel) ? remoteFiles.get(rel).md5 : null;
        const S = base[rel];
        try {
            if (L === R) {
                if (L) base[rel] = L;
                else delete base[rel];
                continue;
            }
            if (L && !R) {
                // Drive'da yok (yeni dosya ya da Drive'dan silinmiş): veri kaybolmasın diye yükle
                await upload(rel, S !== undefined && S !== L ? kind : null);
            } else if (!L && R) {
                if (S !== undefined && S === R) {
                    // Bilgisayarda silindi, Drive'da değişmedi → Drive'daki kopyayı sürümlere taşı
                    await remote.archive(rel);
                    delete base[rel];
                    result.archived.push(rel);
                } else {
                    await download(rel);
                }
            } else if (S === L) {
                await download(rel); // sadece Drive'da değişmiş
            } else if (S === R) {
                await upload(rel, kind); // sadece bilgisayarda değişmiş
            } else {
                // İki tarafta da değişmiş (veya ilk eşitleme): hiçbirini ezme
                const alt = copyName(rel, "Drive'dan");
                const buf = await remote.read(rel);
                writeLocal(alt, buf);
                base[alt] = await remote.write(alt, buf);
                await upload(rel, kind);
                result.conflicts.push(alt);
            }
        } catch (e) {
            console.warn('[DraftRewind] Drive eşitleme:', rel, e.message);
        }
    }
    return result;
}

module.exports = { detectFolders, signIn, DriveApi, ApiRemote, FolderRemote, reconcile };
