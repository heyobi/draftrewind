const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard, safeStorage, Notification, powerMonitor, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const config = require('./core/config');
const { Store } = require('./core/store');
const { Project } = require('./core/engine');
const { Guardian } = require('./core/guardian');
const docs = require('./core/docs');
const github = require('./core/github');
const drive = require('./core/drive');
const I18N = require('./i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const startHidden = process.argv.includes('--hidden');
// Veri klasörü: %APPDATA%/DraftRewind. Eski adıyla (acadamiv-desktop) oluşturulmuşsa taşınır.
function setupUserData() {
    if (process.env.DRAFTREWIND_USERDATA) {
        app.setPath('userData', process.env.DRAFTREWIND_USERDATA);
        return;
    }
    const target = path.join(app.getPath('appData'), 'DraftRewind');
    const old = path.join(app.getPath('appData'), 'acadamiv-desktop');
    if (!fs.existsSync(target) && fs.existsSync(old)) {
        try {
            fs.renameSync(old, target);
        } catch (e) {
            // Eski klasör kilitliyse (ör. eski sürüm hâlâ açık) en azından ayarları ve geçmişi kopyala
            fs.mkdirSync(target, { recursive: true });
            for (const name of ['acadamiv.json', 'acadamiv-settings.json', 'Local State', 'depolar']) {
                try { fs.cpSync(path.join(old, name), path.join(target, name), { recursive: true }); } catch (err) {}
            }
        }
    }
    app.setPath('userData', target);
}
setupUserData();
let mainWindow = null;
let tray = null;
let store = null;
let guardian = null;
let driveApi = null;
let githubLogin = null; // { cancel }
const runtimes = new Map(); // projectId -> runtime

// Tek kopya: zaten açıksa onu öne getir ve bu kopyayı hemen kapat
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.exit(0);
} else {
    app.on('second-instance', () => showWindow());
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------
function emit(type, payload = {}) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('av:event', { type, ...payload });
}

function notify(title, body) {
    if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) return;
    try {
        new Notification({ title, body, icon: iconPath() }).show();
    } catch (e) {}
}

function iconPath() {
    return path.join(__dirname, 'assets', 'icon.png');
}

function projects() {
    return store.get('projects', []);
}

function saveProjectRecord(record) {
    const list = projects().map(p => (p.id === record.id ? record : p));
    store.set('projects', list);
}

function recordOf(id) {
    return projects().find(p => p.id === id);
}

function prefs() {
    return { dailyGoal: 500, guardian: true, autostart: true, language: 'auto', theme: 'system', ...(store.get('prefs', {})) };
}

// Dil: prefs.language ('auto' | 'tr' | 'en'); 'auto' → sistem dili (tr* ise Türkçe, değilse İngilizce)
function systemLocales() {
    const list = [];
    try { list.push(...(app.getPreferredSystemLanguages() || [])); } catch (e) {}
    try { list.push(app.getLocale()); } catch (e) {}
    return list;
}
function applyLanguage() {
    const before = I18N.getLanguage();
    I18N.setLanguage(I18N.resolve(prefs().language, systemLocales()));
    if (tray && before !== I18N.getLanguage()) buildTrayMenu();
}

// Tema: prefs.theme ('system' | 'light' | 'dark') → nativeTheme; arayüzdeki prefers-color-scheme de bunu izler
function applyTheme() {
    const th = prefs().theme;
    nativeTheme.themeSource = th === 'light' || th === 'dark' ? th : 'system';
}

function githubToken() {
    return store.getSecret('github_token');
}

function saveGithubSession(session) {
    store.setSecret('github_token', session ? session.token : null);
    store.setSecret('github_refresh', session ? session.refreshToken : null);
    store.set('githubExpiresAt', session ? session.expiresAt || undefined : undefined);
}

// Süreli jeton kullanılıyorsa (OAuth App ayarı) süresi dolmadan yenile
async function freshGithubToken() {
    const token = githubToken();
    if (!token) return null;
    const session = { token, refreshToken: store.getSecret('github_refresh'), expiresAt: store.get('githubExpiresAt') || null };
    const next = await github.refreshIfNeeded(session);
    if (next.token !== token) saveGithubSession(next);
    return next.token;
}

function dayKey(t) {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ---------------------------------------------------------------------------
// Eski sürüm ayarlarını taşı (düz metin jetonları temizleyerek)
// ---------------------------------------------------------------------------
function migrateOldSettings() {
    const oldFile = path.join(app.getPath('userData'), 'acadamiv-settings.json');
    if (!fs.existsSync(oldFile) || store.get('migrated')) return;
    try {
        const old = JSON.parse(fs.readFileSync(oldFile, 'utf8'));
        if (old.github_token && !githubToken()) {
            store.setSecret('github_token', old.github_token);
            if (old.github_user) store.set('githubUser', { login: old.github_user.login, name: old.github_user.name, avatar: old.github_user.avatar_url, url: old.github_user.html_url });
        }
        if (old.gdrive_tokens && old.gdrive_tokens.refresh_token && !store.getSecret('google_tokens')) {
            store.setSecret('google_tokens', JSON.stringify(old.gdrive_tokens));
            store.set('drive', { mode: 'account', user: old.gdrive_user || null });
        } else if (old.gdrive_local_folder && fs.existsSync(old.gdrive_local_folder)) {
            store.set('drive', { mode: 'folder', folder: old.gdrive_local_folder });
        }
        const folders = [old.active_repo, ...(Array.isArray(old.recent_repos) ? old.recent_repos.map(r => (typeof r === 'string' ? r : r && r.path)) : [])].filter(Boolean);
        const list = projects();
        for (const f of folders) {
            if (fs.existsSync(f) && !list.some(p => p.dir.toLowerCase() === f.toLowerCase())) {
                list.push({ id: crypto.randomBytes(6).toString('hex'), name: path.basename(f), dir: f, createdAt: Date.now() });
            }
        }
        store.set('projects', list);
        // Düz metin jetonları eski dosyadan sil
        for (const k of ['github_token', 'gdrive_tokens', 'google_client_secret']) delete old[k];
        fs.writeFileSync(oldFile, JSON.stringify(old, null, 2));
    } catch (e) {
        console.warn('[DraftRewind] Eski ayarlar taşınamadı:', e.message);
    }
    store.set('migrated', true);
}

// ---------------------------------------------------------------------------
// Proje çalışma zamanı: izleme, otomatik kayıt, bulut
// ---------------------------------------------------------------------------
async function startProject(record) {
    if (runtimes.has(record.id)) return runtimes.get(record.id);
    const user = store.get('githubUser');
    const project = new Project({
        id: record.id,
        name: record.name,
        dir: record.dir,
        gitdir: path.join(app.getPath('userData'), 'depolar', `${record.id}.git`),
        author: { name: (user && user.name) || os.userInfo().username, email: user && user.login ? `${user.login}@users.noreply.github.com` : undefined }
    });
    project.meta = record;
    const rt = { project, watcher: null, timer: null, syncTimer: null, missing: false, syncing: false, lastError: null };
    runtimes.set(record.id, rt);
    if (!fs.existsSync(record.dir)) {
        rt.missing = true;
        return rt;
    }
    await project.open();
    watch(rt);
    await doSnapshot(rt, { kind: 'auto' });
    // Bilgisayar kapalıyken Drive'da yapılan düzenlemeleri hemen al
    syncDrive(rt).catch(() => {});
    scheduleSync(rt, 3000);
    return rt;
}

function stopProject(id) {
    const rt = runtimes.get(id);
    if (!rt) return;
    try { rt.watcher && rt.watcher.close(); } catch (e) {}
    clearTimeout(rt.timer);
    clearTimeout(rt.syncTimer);
    runtimes.delete(id);
}

function watch(rt) {
    try {
        rt.watcher = fs.watch(rt.project.dir, { recursive: true }, (ev, filename) => {
            if (!filename) return scheduleSnapshot(rt);
            const parts = String(filename).split(/[\\/]/);
            const name = parts[parts.length - 1];
            if (parts.some(p => p.startsWith('.'))) return;
            if (/^(~\$|~wrl|\.~lock\.)/i.test(name) || /\.(tmp|temp|asd|wbk)$/i.test(name)) return;
            scheduleSnapshot(rt);
        });
        rt.watcher.on('error', () => {
            rt.missing = !fs.existsSync(rt.project.dir);
            emit('project', { projectId: rt.project.id });
        });
    } catch (e) {
        console.warn('[DraftRewind] Klasör izlenemiyor:', e.message);
    }
}

function scheduleSnapshot(rt) {
    clearTimeout(rt.timer);
    emit('pending', { projectId: rt.project.id });
    const sinceLast = Date.now() - (rt.lastSnapshotAt || 0);
    const delay = Math.max(config.SNAPSHOT_DEBOUNCE_MS, config.MIN_SNAPSHOT_GAP_MS - sinceLast);
    rt.scheduled = true;
    rt.timer = setTimeout(() => doSnapshot(rt, { kind: 'auto' }), delay);
}

async function doSnapshot(rt, opts) {
    rt.scheduled = false;
    if (rt.missing) return null;
    let res = null;
    try {
        res = await rt.project.snapshot(opts);
    } catch (e) {
        console.warn('[DraftRewind] Kayıt alınamadı:', e.message);
        rt.lastError = e.message;
        emit('project', { projectId: rt.project.id });
        return null;
    }
    rt.lastError = null;
    if (res) rt.lastSnapshotAt = Date.now();
    emit('snapshot', { projectId: rt.project.id, snapshot: res });
    if (res) afterChange(rt, res);
    return res;
}

async function afterChange(rt, res) {
    if (res.kind !== 'merge') await syncDrive(rt, res.kind);
    scheduleSync(rt);
}

// Drive ile çift yönlü eşitleme (Drive'da yapılan düzenlemeler de bilgisayara gelir)
function driveRemote() {
    const d = store.get('drive', {});
    if (d.mode === 'folder' && d.folder && fs.existsSync(d.folder)) return new drive.FolderRemote(d.folder);
    if (d.mode === 'account' && driveApi) return new drive.ApiRemote(driveApi);
    return null;
}

async function syncDrive(rt, kind = 'auto') {
    if (rt.missing || rt.driveBusy) return;
    const remote = driveRemote();
    const record = recordOf(rt.project.id);
    if (!remote || !record) return;
    rt.driveBusy = true;
    let result = null;
    try {
        const info = await remote.prepare(rt.project, record);
        const state = record.driveState || {};
        result = await drive.reconcile(rt.project, remote, state, kind);
        const fresh = recordOf(rt.project.id) || record;
        Object.assign(fresh, { driveFolderId: record.driveFolderId, driveFolderName: record.driveFolderName, driveState: state, driveUrl: info.url, driveAt: Date.now(), driveError: null });
        saveProjectRecord(fresh);
    } catch (e) {
        const fresh = recordOf(rt.project.id);
        if (fresh) {
            fresh.driveError = friendlyNetError(e);
            saveProjectRecord(fresh);
        }
    } finally {
        rt.driveBusy = false;
    }
    emit('cloud', { projectId: rt.project.id });
    if (result && result.downloaded.length) {
        const names = [...new Set(result.downloaded.map(r => path.basename(r)))];
        clearTimeout(rt.timer);
        await doSnapshot(rt, { kind: 'merge', title: T('main.driveMerged', { names: names.slice(0, 3).join(', '), more: names.length > 3 ? T('common.andMore', { n: names.length - 3 }) : '' }) });
        emit('toast', { icon: '☁️', text: T('main.driveDownloaded', { n: names.length }) });
    }
    if (result && result.conflicts.length) {
        emit('toast', { icon: '🤝', text: T('main.driveConflicts', { n: result.conflicts.length }) });
    }
}

// Drive bağlantısı değişince (yeni klasör / hesap) eşitleme durumunu sıfırla
function resetDriveState() {
    store.set('projects', projects().map(p => ({ ...p, driveState: undefined, driveFolderId: undefined, driveFolderName: undefined, driveUrl: undefined, driveAt: undefined, driveError: undefined })));
}

function scheduleSync(rt, delay = config.SYNC_DEBOUNCE_MS) {
    if (!githubToken()) return;
    clearTimeout(rt.syncTimer);
    rt.syncTimer = setTimeout(() => runSync(rt), delay);
}

async function runSync(rt) {
    let token;
    try {
        token = await freshGithubToken();
    } catch (e) {
        token = null;
        const r = recordOf(rt.project.id);
        if (r) { r.syncError = e.message; saveProjectRecord(r); }
        emit('cloud', { projectId: rt.project.id });
    }
    if (!token || rt.missing) return;
    if (rt.syncing) return scheduleSync(rt, 10000);
    rt.syncing = true;
    emit('cloud', { projectId: rt.project.id, syncing: true });
    let record = recordOf(rt.project.id);
    try {
        if (!record.github) {
            record.github = await github.ensureRepo(token, store.get('githubUser'), record);
            saveProjectRecord(record);
        }
        rt.project.meta = record;
        const r = await github.sync(rt.project, token);
        record = recordOf(rt.project.id);
        record.lastSync = r.at;
        record.syncError = null;
        saveProjectRecord(record);
        if (r.pulled) {
            emit('toast', { icon: '📥', text: T('main.pulled', { n: r.pulled }) });
            emit('snapshot', { projectId: rt.project.id });
        }
        if (r.conflicts.length) {
            emit('toast', { icon: '🤝', text: T('main.ghConflicts', { n: r.conflicts.length }) });
        }
    } catch (e) {
        record = recordOf(rt.project.id);
        if (record) {
            record.syncError = friendlyNetError(e);
            saveProjectRecord(record);
        }
        // İnternet yoksa daha sonra tekrar dene
        clearTimeout(rt.syncTimer);
        rt.syncTimer = setTimeout(() => runSync(rt), 5 * 60 * 1000);
    } finally {
        rt.syncing = false;
        emit('cloud', { projectId: rt.project.id, syncing: false });
    }
}

function friendlyNetError(e) {
    const m = String((e && e.message) || e);
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|EAI_AGAIN|network/i.test(m)) return T('main.offline');
    return m;
}

async function snapshotAll(kind = 'auto') {
    for (const rt of runtimes.values()) {
        clearTimeout(rt.timer);
        await doSnapshot(rt, { kind });
    }
}

async function runGuardian() {
    if (!prefs().guardian || !guardian) return;
    const list = [...runtimes.values()].filter(rt => !rt.missing).map(rt => ({ id: rt.project.id, dir: rt.project.dir }));
    const rescued = await guardian.run(list);
    const byProject = new Set(rescued.map(r => r.projectId));
    for (const id of byProject) {
        const rt = runtimes.get(id);
        if (rt) await doSnapshot(rt, { kind: 'rescue' });
    }
    if (rescued.length) {
        const names = [...new Set(rescued.map(r => r.docName))].join(', ');
        emit('toast', { icon: '⚡', text: T('main.rescued', { names }) });
        notify(T('notif.rescuedTitle'), T('notif.rescuedBody', { names }));
    }
}

// ---------------------------------------------------------------------------
// İstatistik ve özet
// ---------------------------------------------------------------------------
const historyCache = new Map(); // id -> { head, list }
async function fullHistory(rt) {
    const head = await rt.project.head();
    const c = historyCache.get(rt.project.id);
    if (c && c.head === head) return c.list;
    const list = await rt.project.history({ limit: 5000 });
    historyCache.set(rt.project.id, { head, list });
    return list;
}

function computeStats(history) {
    // Günlük yazılan kelime: o günün son toplamı - önceki aktif günün son toplamı
    const chron = [...history].reverse();
    const dayLast = new Map();
    const activeDays = new Set();
    for (const h of chron) {
        const k = dayKey(h.time);
        if (typeof h.total === 'number') dayLast.set(k, h.total);
        if (h.kind !== 'merge') activeDays.add(k);
    }
    const perDay = new Map();
    let prevTotal = null;
    for (const [k, total] of dayLast) {
        perDay.set(k, prevTotal == null ? 0 : total - prevTotal);
        prevTotal = total;
    }
    const today = new Date();
    const week = [];
    const labels = I18N.text('time.daysShort');
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        week.push({ label: i === 0 ? T('time.today') : labels[d.getDay()], dow: d.getDay(), words: Math.max(0, perDay.get(dayKey(d)) || 0), active: activeDays.has(dayKey(d)) });
    }
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        if (activeDays.has(dayKey(d))) streak++;
        else if (i > 0) break;
    }
    return {
        today: perDay.get(dayKey(today)) || 0,
        week,
        streak,
        total: history.length && typeof history[0].total === 'number' ? history[0].total : 0,
        snapshots: history.length,
        firstAt: chron.length ? chron[0].time : null
    };
}

async function overview(id) {
    const rt = runtimes.get(id);
    const record = recordOf(id);
    if (!rt || !record) throw new Error(T('err.projectNotFound'));
    if (rt.missing) return { id, name: record.name, dir: record.dir, missing: true };
    const [st, history] = await Promise.all([rt.project.status(), fullHistory(rt)]);
    const lastWords = (await rt.project.lastMeta(st.head)).words || {};
    const pending = new Set([...st.changes.added, ...st.changes.modified]);
    const files = [...st.files.entries()]
        .map(([rel, f]) => ({ rel, name: path.basename(rel), kind: docs.kindOf(rel), size: f.size, mtime: f.mtimeMs, words: lastWords[rel] ?? null, pending: pending.has(rel), rescue: rel.startsWith(config.RESCUE_DIR + '/') }))
        .sort((a, b) => b.mtime - a.mtime);
    return {
        id,
        name: record.name,
        dir: record.dir,
        missing: false,
        lastSave: history.length ? history[0].time : null,
        pendingCount: pending.size + st.changes.deleted.length,
        stats: computeStats(history),
        files,
        skippedLarge: rt.project.skippedLarge,
        error: rt.lastError,
        cloud: cloudInfo(record, rt)
    };
}

function cloudInfo(record, rt) {
    return {
        github: record.github || null,
        lastSync: record.lastSync || null,
        syncError: record.syncError || null,
        syncing: !!(rt && rt.syncing),
        driveUrl: record.driveUrl || null,
        driveAt: record.driveAt || null,
        driveError: record.driveError || null
    };
}

function appState() {
    const d = store.get('drive', {});
    return {
        projects: projects().map(p => {
            const rt = runtimes.get(p.id);
            return { id: p.id, name: p.name, dir: p.dir, emoji: p.emoji || null, missing: !!(rt && rt.missing) };
        }),
        activeId: store.get('activeId') || (projects()[0] && projects()[0].id) || null,
        github: githubToken() ? { connected: true, user: store.get('githubUser') } : { connected: false },
        drive: { mode: d.mode || null, folder: d.folder || null, user: d.user || null, detected: drive.detectFolders(), accountAvailable: !!config.GOOGLE_CLIENT_ID },
        prefs: prefs(),
        lang: I18N.getLanguage(),
        platform: process.platform,
        version: app.getVersion()
    };
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
        try {
            return { ok: true, data: await fn(...args) };
        } catch (e) {
            return { ok: false, error: e.message || String(e) };
        }
    });
}

function rtOf(id) {
    const rt = runtimes.get(id);
    if (!rt) throw new Error(T('err.projectNotFound'));
    return rt;
}

function absOf(rt, rel) {
    const abs = path.resolve(rt.project.dir, ...rel.split('/'));
    if (!abs.toLowerCase().startsWith(path.resolve(rt.project.dir).toLowerCase())) throw new Error(T('err.badPath'));
    return abs;
}

async function addProjectFromDir(dir, name) {
    const existing = projects().find(p => path.resolve(p.dir).toLowerCase() === path.resolve(dir).toLowerCase());
    if (existing) {
        store.set('activeId', existing.id);
        return existing.id;
    }
    const record = { id: crypto.randomBytes(6).toString('hex'), name: name || path.basename(dir), dir, createdAt: Date.now() };
    store.set('projects', [...projects(), record]);
    store.set('activeId', record.id);
    const rt = await startProject(record);
    // Drive bağlıysa mevcut dosyaları hemen eşitle
    syncDrive(rt, 'star');
    return record.id;
}

function registerIpc() {
    handle('app:state', () => appState());

    handle('project:add', async () => {
        const r = await dialog.showOpenDialog(mainWindow, {
            title: T('dlg.pickFolder'),
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: T('dlg.protectBtn')
        });
        if (r.canceled || !r.filePaths.length) return null;
        const dir = r.filePaths[0];
        if (path.resolve(dir) === path.parse(dir).root || path.resolve(dir) === os.homedir()) {
            throw new Error(T('err.tooBroad'));
        }
        return addProjectFromDir(dir);
    });

    handle('project:create', async name => {
        const clean = String(name || '').replace(/[<>:"/\\|?*]/g, '').trim() || 'Tezim';
        const dir = path.join(app.getPath('documents'), 'DraftRewind', clean);
        fs.mkdirSync(dir, { recursive: true });
        const id = await addProjectFromDir(dir, clean);
        shell.openPath(dir);
        return id;
    });

    handle('project:remove', id => {
        stopProject(id);
        store.set('projects', projects().filter(p => p.id !== id));
        if (store.get('activeId') === id) store.set('activeId', projects()[0] ? projects()[0].id : null);
        return true;
    });

    handle('project:update', (id, patch) => {
        const r = recordOf(id);
        if (!r) throw new Error(T('err.projectNotFound'));
        if (typeof patch.name === 'string' && patch.name.trim()) r.name = patch.name.trim();
        if (typeof patch.emoji === 'string') r.emoji = patch.emoji;
        saveProjectRecord(r);
        const rt = runtimes.get(id);
        if (rt) rt.project.name = r.name;
        return true;
    });

    handle('project:relink', async id => {
        const r = await dialog.showOpenDialog(mainWindow, { title: T('dlg.relink'), properties: ['openDirectory'] });
        if (r.canceled || !r.filePaths.length) return false;
        const rec = recordOf(id);
        rec.dir = r.filePaths[0];
        saveProjectRecord(rec);
        stopProject(id);
        await startProject(rec);
        return true;
    });

    handle('project:setActive', id => {
        store.set('activeId', id);
        return true;
    });

    handle('project:overview', id => overview(id));

    handle('project:history', async (id, opts = {}) => {
        const rt = rtOf(id);
        const list = await fullHistory(rt);
        if (!opts.file) return list.slice(0, opts.limit || 400);
        return list.filter(h => !h.changed || h.changed.includes(opts.file) || h.deleted.includes(opts.file)).slice(0, opts.limit || 400);
    });

    handle('project:changes', (id, oid) => rtOf(id).project.commitChanges(oid));

    handle('project:diff', async (id, rel, oid) => {
        const p = rtOf(id).project;
        const parent = await p.parentOf(oid);
        return p.diff(rel, parent, oid);
    });

    handle('project:fileBuffer', async (id, rel, oid) => {
        const buf = await rtOf(id).project.readAt(oid || 'working', rel);
        return buf ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null;
    });

    handle('project:snapshot', async (id, opts = {}) => {
        const rt = rtOf(id);
        clearTimeout(rt.timer);
        const res = await doSnapshot(rt, { kind: opts.star ? 'star' : 'auto', title: opts.title, note: opts.note, force: !!opts.star });
        if (opts.star) runSync(rt);
        return res;
    });

    handle('project:restore', async (id, rel, oid, mode) => {
        const rt = rtOf(id);
        const r = await rt.project.restore(rel, oid, mode);
        if (mode !== 'copy') afterChange(rt, { changed: [rel], deleted: [], kind: 'restore' });
        emit('snapshot', { projectId: id });
        return r;
    });

    // Eski bir sürümü, asıl dosyaya dokunmadan Word'de salt okunur aç
    handle('project:openVersion', async (id, rel, oid) => {
        const rt = rtOf(id);
        const buf = await rt.project.readAt(oid, rel);
        if (!buf) throw new Error(T('err.noFileInVersion'));
        const dir = path.join(os.tmpdir(), 'DraftRewind Sürümler');
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(rel);
        const file = path.join(dir, `${path.basename(rel, ext)} (eski sürüm ${oid.slice(0, 6)})${ext}`);
        try { fs.chmodSync(file, 0o666); } catch (e) {}
        fs.writeFileSync(file, buf);
        try { fs.chmodSync(file, 0o444); } catch (e) {}
        const err = await shell.openPath(file);
        if (err) throw new Error(err);
        return true;
    });

    handle('file:open', async (id, rel) => {
        const err = await shell.openPath(absOf(rtOf(id), rel));
        if (err) throw new Error(err);
        return true;
    });
    handle('file:reveal', (id, rel) => {
        shell.showItemInFolder(absOf(rtOf(id), rel));
        return true;
    });
    handle('project:openFolder', async id => {
        const err = await shell.openPath(recordOf(id).dir);
        if (err) throw new Error(err);
        return true;
    });

    // --- GitHub -------------------------------------------------------------
    handle('github:login', async () => {
        if (githubLogin) githubLogin.cancelled = true;
        const flow = await github.startDeviceFlow();
        const token = { cancelled: false };
        githubLogin = token;
        clipboard.writeText(flow.user_code);
        setTimeout(() => shell.openExternal(flow.verification_uri), 900);
        github
            .waitForToken(flow, token)
            .then(async session => {
                const user = await github.getUser(session.token);
                saveGithubSession(session);
                store.set('githubUser', user);
                emit('github', { state: 'connected', user });
                showWindow();
                for (const rt of runtimes.values()) {
                    rt.project.author = { name: user.name, email: `${user.login}@users.noreply.github.com` };
                    scheduleSync(rt, 1000);
                }
            })
            .catch(e => {
                if (!token.cancelled) emit('github', { state: 'error', message: e.message });
            });
        return { code: flow.user_code, url: flow.verification_uri };
    });
    handle('github:cancel', () => {
        if (githubLogin) githubLogin.cancelled = true;
        githubLogin = null;
        return true;
    });
    handle('github:logout', () => {
        saveGithubSession(null);
        store.set('githubUser', undefined);
        return true;
    });
    handle('github:syncNow', async id => {
        const rt = rtOf(id);
        clearTimeout(rt.timer);
        await doSnapshot(rt, { kind: 'auto' });
        await runSync(rt);
        return cloudInfo(recordOf(id), rt);
    });

    // --- Drive --------------------------------------------------------------
    handle('drive:useFolder', async folder => {
        let chosen = folder;
        if (!chosen) {
            const detected = drive.detectFolders();
            const r = await dialog.showOpenDialog(mainWindow, {
                title: T('dlg.pickDrive'),
                defaultPath: detected[0] ? detected[0].path : os.homedir(),
                properties: ['openDirectory'],
                buttonLabel: T('dlg.useFolder')
            });
            if (r.canceled || !r.filePaths.length) return null;
            chosen = r.filePaths[0];
        }
        store.set('drive', { mode: 'folder', folder: chosen });
        driveApi = null;
        resetDriveState();
        for (const rt of runtimes.values()) syncDrive(rt, 'star');
        return appState().drive;
    });
    handle('drive:signIn', async () => {
        const { tokens, user } = await drive.signIn(url => shell.openExternal(url));
        store.setSecret('google_tokens', JSON.stringify(tokens));
        store.set('drive', { mode: 'account', user, clientId: config.GOOGLE_CLIENT_ID });
        setupDriveApi();
        showWindow();
        resetDriveState();
        for (const rt of runtimes.values()) syncDrive(rt, 'star');
        return appState().drive;
    });
    handle('drive:disconnect', () => {
        store.set('drive', {});
        resetDriveState();
        store.setSecret('google_tokens', null);
        driveApi = null;
        return true;
    });
    handle('drive:open', async id => {
        const r = recordOf(id);
        if (!r || !r.driveUrl) throw new Error(T('err.notUploaded'));
        if (/^https:\/\//.test(r.driveUrl)) await shell.openExternal(r.driveUrl);
        else await shell.openPath(r.driveUrl);
        return true;
    });

    // --- Genel --------------------------------------------------------------
    handle('prefs:set', (key, value) => {
        const p = { ...(store.get('prefs', {})), [key]: value };
        store.set('prefs', p);
        if (key === 'autostart') applyAutostart();
        if (key === 'language') applyLanguage();
        if (key === 'theme') applyTheme();
        return prefs();
    });
    handle('shell:openExternal', url => {
        if (!/^https:\/\//.test(String(url))) throw new Error(T('err.badLink'));
        return shell.openExternal(url);
    });
}

function setupDriveApi() {
    driveApi = new drive.DriveApi(
        () => {
            try { return JSON.parse(store.getSecret('google_tokens') || 'null'); } catch (e) { return null; }
        },
        t => store.setSecret('google_tokens', JSON.stringify(t))
    );
}

// ---------------------------------------------------------------------------
// Pencere ve sistem tepsisi
// ---------------------------------------------------------------------------
function overlayColors() {
    return nativeTheme.shouldUseDarkColors ? { color: '#0f0f17', symbolColor: '#c7c7d9', height: 44 } : { color: '#f5f4fb', symbolColor: '#4b4b63', height: 44 };
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1260,
        height: 820,
        minWidth: 940,
        minHeight: 620,
        show: false,
        title: 'DraftRewind',
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f0f17' : '#f5f4fb',
        titleBarStyle: 'hidden',
        titleBarOverlay: overlayColors(),
        icon: iconPath(),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    // ready-to-show bazı sistemlerde hiç tetiklenmiyor: sayfa yüklenince ve en geç 3 sn sonra da göster
    const firstShow = () => {
        if (startHidden || !mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
        mainWindow.show();
        mainWindow.focus();
    };
    mainWindow.once('ready-to-show', firstShow);
    mainWindow.webContents.once('did-finish-load', firstShow);
    setTimeout(firstShow, 3000);
    // Geliştirme: DRAFTREWIND_SCREENSHOT=dosya.png ile arayüzün ekran görüntüsünü al
    if (process.env.DRAFTREWIND_SCREENSHOT) {
        mainWindow.webContents.once('did-finish-load', () => {
            setTimeout(async () => {
                if (process.env.DRAFTREWIND_EVAL) await mainWindow.webContents.executeJavaScript(process.env.DRAFTREWIND_EVAL).catch(e => console.error(e));
                setTimeout(async () => {
                    const img = await mainWindow.webContents.capturePage();
                    fs.writeFileSync(process.env.DRAFTREWIND_SCREENSHOT, img.toPNG());
                    app.isQuitting = true;
                    app.exit(0);
                }, Number(process.env.DRAFTREWIND_WAIT || 1500));
            }, 2500);
        });
    }
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.on('close', e => {
        if (app.isQuitting) return;
        e.preventDefault();
        mainWindow.hide();
        if (!store.get('trayHintShown')) {
            store.set('trayHintShown', true);
            try {
                new Notification({ title: T('notif.trayTitle'), body: T('notif.trayBody'), icon: iconPath() }).show();
            } catch (err) {}
        }
    });
    nativeTheme.on('updated', () => {
        try { mainWindow.setTitleBarOverlay(overlayColors()); } catch (e) {}
    });
}

function showWindow() {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function createTray() {
    const img = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    buildTrayMenu();
    tray.on('click', showWindow);
}

// Dil değişince yeniden kurulur
function buildTrayMenu() {
    if (!tray) return;
    tray.setToolTip(T('tray.tooltip'));
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: T('tray.open'), click: showWindow },
            { label: T('tray.saveNow'), click: () => snapshotAll('auto') },
            { type: 'separator' },
            { label: T('tray.quit'), click: () => { app.isQuitting = true; app.quit(); } }
        ])
    );
}

function applyAutostart() {
    if (!app.isPackaged) return; // geliştirme sırasında sisteme kayıt yapma
    app.setLoginItemSettings({ openAtLogin: !!prefs().autostart, args: ['--hidden'] });
}

// ---------------------------------------------------------------------------
// Yaşam döngüsü
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
    if (!gotLock) return;
    if (process.platform === 'win32') app.setAppUserModelId('com.draftrewind.app');
    const storeFile = path.join(app.getPath('userData'), 'draftrewind.json');
    const oldStoreFile = path.join(app.getPath('userData'), 'acadamiv.json');
    if (!fs.existsSync(storeFile) && fs.existsSync(oldStoreFile)) fs.renameSync(oldStoreFile, storeFile);
    store = new Store(storeFile, safeStorage);
    migrateOldSettings();
    applyLanguage();
    applyTheme();
    // Google jetonları başka bir istemci kimliğiyle (ör. eski rclone kimliği) alındıysa geçersizdir
    const d = store.get('drive', {});
    if (d.mode === 'account' && d.clientId !== config.GOOGLE_CLIENT_ID) {
        store.set('drive', {});
        store.setSecret('google_tokens', null);
    } else if (d.mode === 'account') {
        setupDriveApi();
    }
    guardian = new Guardian(path.join(app.getPath('userData'), 'koruyucu'));
    registerIpc();
    createWindow();
    createTray();
    applyAutostart();

    for (const record of projects()) {
        startProject(record).catch(e => console.warn('[DraftRewind] Proje açılamadı:', record.name, e.message));
    }

    // İzleyicinin kaçırmış olabileceği değişiklikler için periyodik tarama (bekleme sınırına uyar)
    setInterval(async () => {
        for (const rt of runtimes.values()) {
            if (rt.missing || rt.scheduled) continue;
            try {
                const st = await rt.project.status();
                const c = st.changes;
                if (c.added.length || c.modified.length || c.deleted.length) scheduleSnapshot(rt);
            } catch (e) {}
        }
    }, config.RESCAN_INTERVAL_MS);
    // Drive'da yapılan düzenlemeleri düzenli olarak kontrol et
    setInterval(() => {
        for (const rt of runtimes.values()) syncDrive(rt);
    }, config.DRIVE_POLL_MS);
    setInterval(runGuardian, config.GUARDIAN_INTERVAL_MS);
    setTimeout(runGuardian, 30 * 1000);

    // Uyku, ekran kilidi, kapanma: hemen kaydet
    const emergency = () => {
        runGuardian().finally(() => snapshotAll('auto'));
    };
    powerMonitor.on('suspend', emergency);
    powerMonitor.on('lock-screen', emergency);
    powerMonitor.on('shutdown', emergency);
    powerMonitor.on('on-battery', emergency);
    powerMonitor.on('resume', () => {
        for (const rt of runtimes.values()) scheduleSync(rt, 15000);
    });
});

// Çıkmadan önce son bir kayıt (en fazla 5 sn beklenir)
let finalSnapshotDone = false;
app.on('before-quit', e => {
    app.isQuitting = true;
    if (finalSnapshotDone || !store) return;
    e.preventDefault();
    finalSnapshotDone = true;
    Promise.race([snapshotAll('auto'), new Promise(r => setTimeout(r, 5000))]).finally(() => app.quit());
});

app.on('window-all-closed', () => {
    // Tepside çalışmaya devam et
});
