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
const { LocalAI, cleanTitle, grounded, hasContent } = require('./core/ai');
const facts = require('./core/facts');
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
let ai = null; // isteğe bağlı yerel yapay zekâ (app/core/ai.js)
// Hangi yoldan kapanırsa kapansın (app.exit dahil) yapay zekâ motorunu arkada açık bırakma
process.on('exit', () => {
    if (ai) ai.stop();
});
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
    return { dailyGoal: 500, guardian: true, autostart: true, language: 'auto', theme: 'system', aiTitles: false, ...(store.get('prefs', {})) };
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

// ---------------------------------------------------------------------------
// Eski sürümler: geçici klasörde salt okunur açılır. Kullanıcı yine de düzenleyip kaydederse
// (üstüne ya da "Farklı kaydet" ile aynı klasöre) fark edilir ve projeye eklemesi önerilir.
// ---------------------------------------------------------------------------
const openedVersions = new Map(); // dosya yolu (küçük harf) → { projectId, rel, mtimeMs, size }
let oldVersionWatcher = null;
const oldVersionTimers = new Map();

function oldVersionsDir() {
    return path.join(os.tmpdir(), 'DraftRewind Sürümler');
}

function watchOldVersions() {
    if (oldVersionWatcher) return;
    try {
        oldVersionWatcher = fs.watch(oldVersionsDir(), (ev, name) => {
            if (!name || /^(~\$|~wrl)|\.tmp$/i.test(name)) return;
            clearTimeout(oldVersionTimers.get(name));
            oldVersionTimers.set(name, setTimeout(() => checkOldVersion(name), 1500));
        });
    } catch (e) {}
}

function checkOldVersion(name) {
    const file = path.join(oldVersionsDir(), name);
    let st;
    try {
        st = fs.statSync(file);
    } catch (e) {
        return;
    }
    const key = file.toLowerCase();
    const known = openedVersions.get(key);
    if (known && known.mtimeMs === st.mtimeMs && known.size === st.size) return;
    // Bilinmeyen yeni dosya = "Farklı kaydet" ile kaydedilmiş: en son açılan sürüme bağla
    const ref = known || [...openedVersions.values()].pop();
    if (!ref) return;
    openedVersions.set(key, { ...ref, mtimeMs: st.mtimeMs, size: st.size });
    emit('oldVersionEdited', { projectId: ref.projectId, file, name, rel: ref.rel });
    showWindow();
    notify(T('old.editedTitle'), T('old.editedBody', { name }));
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
    project.aiTitle = aiTitle;
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
        // Klasör kimliğini HEMEN kaydet: ilk eşitleme yarıda kalırsa bir sonrakinde "Ad (2)" oluşmasın
        const early = recordOf(rt.project.id);
        if (early && (early.driveFolderId !== record.driveFolderId || early.driveFolderName !== record.driveFolderName || early.driveUrl !== info.url)) {
            Object.assign(early, { driveFolderId: record.driveFolderId, driveFolderName: record.driveFolderName, driveUrl: info.url });
            saveProjectRecord(early);
        }
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
        emit('toast', { icon: 'cloud', text: T('main.driveDownloaded', { n: names.length }) });
    }
    if (result && result.conflicts.length) {
        emit('toast', { icon: 'merge', text: T('main.driveConflicts', { n: result.conflicts.length }) });
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
        record.githubOid = r.head || undefined; // GitHub'daki son kayıt (dosya bazlı yedek durumu için)
        record.syncError = null;
        saveProjectRecord(record);
        if (r.pulled) {
            emit('toast', { icon: 'inbox', text: T('main.pulled', { n: r.pulled }) });
            notify('DraftRewind', T('main.pulled', { n: r.pulled }));
            emit('snapshot', { projectId: rt.project.id });
            // Telefondan / başka bilgisayardan gelen dosyalar Drive kopyasına da gitsin
            syncDrive(rt).catch(() => {});
        }
        if (r.conflicts.length) {
            emit('toast', { icon: 'merge', text: T('main.ghConflicts', { n: r.conflicts.length }) });
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
        emit('toast', { icon: 'bolt', text: T('main.rescued', { names }) });
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

// Dosya bazlı yedek durumu: kullanıcı yedeklenmeyen dosyayı mutlaka görsün. Yalnız önbellekler
// kullanılır (büyük dosyalar burada asla okunmaz/özetlenmez). Dönen fonksiyon (rel, f) →
// { history: bool, github: true|false|'pending'|null, drive: true|false|'pending'|null, reason }
// null = o servis bağlı değil · reason: null | 'tooLargeForHistory' | 'locked' | 'driveError'
async function backupStatus(rt, record, st) {
    const d = store.get('drive', {});
    const driveOn = !!((d.mode === 'folder' && d.folder && fs.existsSync(d.folder)) || (d.mode === 'account' && driveApi));
    const ghOn = !!githubToken();
    const base = (record.driveState && record.driveState.base) || {};
    const md5s = rt.project.md5Cache || {};
    let pushed = null;
    if (ghOn && record.github && record.githubOid) {
        try { pushed = await rt.project.treeFiles(record.githubOid); } catch (e) {}
    }
    return (rel, f) => {
        const large = !!f.large;
        const locked = !large && rt.project.lockedFiles.has(rel);
        const history = !large && !(locked && !st.headFiles.has(rel));
        let driveState = null;
        if (driveOn) {
            const c = md5s[rel];
            driveState = c && c.m === f.mtimeMs && c.s === f.size && base[rel] === c.md5 ? true : 'pending';
        }
        let gh = null;
        if (ghOn) {
            const w = st.working.get(rel);
            gh = large ? false : pushed && w && pushed.get(rel) === w ? true : 'pending';
        }
        let reason = null;
        if (large) reason = 'tooLargeForHistory';
        else if (locked) reason = 'locked';
        else if (driveState === 'pending' && record.driveError) reason = 'driveError';
        return { history, github: gh, drive: driveState, reason };
    };
}

async function overview(id) {
    const rt = runtimes.get(id);
    const record = recordOf(id);
    if (!rt || !record) throw new Error(T('err.projectNotFound'));
    if (rt.missing) return { id, name: record.name, dir: record.dir, missing: true };
    const [st, history] = await Promise.all([rt.project.status(), fullHistory(rt)]);
    // Başka yerde yapılan kayıtlarda (telefon, GitHub web) kelime bilgisi yok: en yakın bilinen kayıttan
    const lastWords = (await rt.project.wordsBase(st.head, st.headFiles)).words || {};
    const pending = new Set([...st.changes.added, ...st.changes.modified]);
    const backupOf = await backupStatus(rt, record, st);
    // Geçmişe girmeyen büyük dosyalar da listelenir (yedek durumlarıyla birlikte)
    const files = [...st.files.entries(), ...rt.project.largeFiles.entries()]
        .map(([rel, f]) => ({ rel, name: path.basename(rel), kind: docs.kindOf(rel), size: f.size, mtime: f.mtimeMs, words: lastWords[rel] ?? null, pending: pending.has(rel), rescue: rel.startsWith(config.RESCUE_DIR + '/'), large: !!f.large, backup: backupOf(rel, f) }))
        .sort((a, b) => b.mtime - a.mtime);
    // Hiçbir yerde korunmayan dosyalar (ör. Drive bağlı değilken 10 GB'lık dosya)
    const unprotected = files.filter(f => f.backup.history === false && f.backup.drive !== true).map(f => ({ rel: f.rel, name: f.name, size: f.size, reason: f.backup.reason, drive: f.backup.drive }));
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
        unprotected,
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
            return { id: p.id, name: p.name, dir: p.dir, emoji: p.emoji || null, color: p.color || null, missing: !!(rt && rt.missing) };
        }),
        activeId: store.get('activeId') || (projects()[0] && projects()[0].id) || null,
        github: githubToken() ? { connected: true, user: store.get('githubUser') } : { connected: false },
        drive: { mode: d.mode || null, folder: d.folder || null, user: d.user || null, detected: drive.detectFolders(), accountAvailable: !!config.GOOGLE_CLIENT_ID },
        prefs: prefs(),
        ai: ai ? ai.status() : null,
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
        if (typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)) r.color = patch.color;
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

    handle('project:changes', (id, oid) => (oid === 'working' ? rtOf(id).project.workingChanges() : rtOf(id).project.commitChanges(oid)));

    handle('project:diff', async (id, rel, oid) => {
        const p = rtOf(id).project;
        // 'working': son kayıt noktasından bu yana dosyada kaydedilmiş değişiklikler
        const parent = oid === 'working' ? await p.head() : await p.parentOf(oid);
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
        const dir = oldVersionsDir();
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(rel);
        const when = new Date(await rt.project.commitTime(oid));
        const pad = n => String(n).padStart(2, '0');
        const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}.${pad(when.getMinutes())}`;
        const file = path.join(dir, `${path.basename(rel, ext)} (${T('old.fileTag', { date })})${ext}`);
        try { fs.chmodSync(file, 0o666); } catch (e) {}
        fs.writeFileSync(file, buf);
        // "İnternetten geldi" işareti: Word/Excel dosyayı Korumalı Görünüm'de (düzenleme kapalı) açar
        if (process.platform === 'win32') {
            try { fs.writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n'); } catch (e) {}
        }
        try { fs.chmodSync(file, 0o444); } catch (e) {}
        const st = fs.statSync(file);
        openedVersions.set(file.toLowerCase(), { projectId: id, rel, mtimeMs: st.mtimeMs, size: st.size });
        watchOldVersions();
        const err = await shell.openPath(file);
        if (err) throw new Error(err);
        return true;
    });

    // Eski sürümden düzenlenmiş dosyayı projeye kopya olarak ekle
    handle('project:importEdited', (id, file, rel) => {
        const rt = rtOf(id);
        if (!path.resolve(file).toLowerCase().startsWith(oldVersionsDir().toLowerCase())) throw new Error('Geçersiz dosya');
        const ext = path.extname(rel);
        const baseRel = rel.slice(0, rel.length - ext.length);
        let target;
        for (let i = 1; i < 100; i++) {
            target = absOf(rt, `${baseRel} (${T('old.copySuffix')}${i > 1 ? ` ${i}` : ''})${ext}`);
            if (!fs.existsSync(target)) break;
        }
        fs.copyFileSync(file, target);
        try { fs.chmodSync(target, 0o666); } catch (e) {}
        try { fs.unlinkSync(`${target}:Zone.Identifier`); } catch (e) {}
        return { path: target, name: path.basename(target) };
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
    registerUxIpc();
    registerAiIpc();
}

// ---------------------------------------------------------------------------
// Dosya eylemleri (sağ tık menüsü, dosyayı panoya kopyalama, dışarı sürükleme, dosya ekleme),
// GitHub'dan proje açma ve telefonu QR ile eşleme
// ---------------------------------------------------------------------------
const versionTempFiles = new Map(); // `${id}|${rel}|${oid}` → geçici dosya yolu

// Eski bir sürümün paylaşılabilir geçici kopyası (openVersion ile aynı adlandırma, aynı klasör)
async function versionTempFile(id, rel, oid) {
    const key = `${id}|${rel}|${oid}`;
    const cached = versionTempFiles.get(key);
    if (cached && fs.existsSync(cached)) return cached;
    const rt = rtOf(id);
    const buf = await rt.project.readAt(oid, rel);
    if (!buf) throw new Error(T('err.noFileInVersion'));
    const dir = oldVersionsDir();
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(rel);
    const when = new Date(await rt.project.commitTime(oid));
    const pad = n => String(n).padStart(2, '0');
    const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}.${pad(when.getMinutes())}`;
    const file = path.join(dir, `${path.basename(rel, ext)} (${T('old.fileTag', { date })})${ext}`);
    try {
        try { fs.chmodSync(file, 0o666); } catch (e) {}
        fs.writeFileSync(file, buf);
    } catch (e) {
        // Word'de açık (kilitli) olabilir: aynı sürümün dosyası zaten orada
        if (!fs.existsSync(file)) throw e;
    }
    // Eski sürüm izleyicisi bunu "düzenlendi" sanmasın
    try {
        const st = fs.statSync(file);
        openedVersions.set(file.toLowerCase(), { projectId: id, rel, mtimeMs: st.mtimeMs, size: st.size });
    } catch (e) {}
    versionTempFiles.set(key, file);
    return file;
}

// Dosyanın kendisini panoya koyar (Gezgin, WhatsApp, Outlook, Teams… içine yapıştırılabilir)
function copyFileToClipboard(file) {
    if (process.platform !== 'win32') {
        clipboard.writeText(file);
        return Promise.resolve('path');
    }
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -LiteralPath $env:DRAFTREWIND_CLIP'],
            { windowsHide: true, timeout: 15000, env: { ...process.env, DRAFTREWIND_CLIP: file } },
            err => (err ? reject(new Error(T('fx.copyFailed'))) : resolve('file'))
        );
    });
}

let dragIcon = null;
function dragIconImage() {
    if (!dragIcon || dragIcon.isEmpty()) dragIcon = nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32 });
    return dragIcon;
}

function uniqueTarget(dir, name) {
    const ext = path.extname(name);
    const base = ext ? name.slice(0, -ext.length) : name;
    let target = path.join(dir, name);
    for (let i = 2; fs.existsSync(target) && i < 1000; i++) target = path.join(dir, `${base} (${i})${ext}`);
    return target;
}

// Dışarıdan gelen dosya/klasörleri proje köküne kopyalar; hiçbir şeyin üzerine yazmaz
function copyIntoProject(rt, sources) {
    const root = path.resolve(rt.project.dir);
    const contains = (parent, child) => {
        const rel = path.relative(parent, child);
        return !rel || (!rel.startsWith('..') && !path.isAbsolute(rel));
    };
    const added = [];
    const skipped = [];
    for (const raw of sources || []) {
        const src = path.resolve(String(raw || ''));
        let st;
        try {
            st = fs.statSync(src);
        } catch (e) {
            continue;
        }
        // Projenin kendi dosyası (ör. uygulamadan sürüklenip geri bırakılan) ya da projeyi içeren klasör
        if (contains(root, src) || contains(src, root)) {
            skipped.push(path.basename(src));
            continue;
        }
        const target = uniqueTarget(root, path.basename(src));
        try {
            if (st.isDirectory()) fs.cpSync(src, target, { recursive: true, errorOnExist: true, force: false });
            else fs.copyFileSync(src, target, fs.constants.COPYFILE_EXCL);
            added.push(path.basename(target));
        } catch (e) {
            skipped.push(path.basename(src));
        }
    }
    if (added.length) scheduleSnapshot(rt);
    return { added, skipped };
}

function registerUxIpc() {
    // Yerel sağ tık menüsü. Seçilen eylem burada yapılır; arayüzü ilgilendirenler geri döndürülür.
    handle('file:menu', (id, rel, opts = {}) => {
        const rt = rtOf(id);
        const old = !!(opts.oid && opts.oid !== 'working');
        const gone = !!opts.deleted;
        return new Promise(resolve => {
            let done = false;
            const pick = action => () => {
                if (done) return;
                done = true;
                resolve(action);
            };
            const template = old
                ? [
                      { label: T('fx.openVersion'), click: pick('openVersion'), enabled: !gone },
                      { label: T('fx.copyVersion'), click: pick('copyVersion'), enabled: !gone },
                      { type: 'separator' },
                      { label: T('fx.showHistory'), click: pick('history') }
                  ]
                : [
                      { label: T('fx.open'), click: pick('open'), enabled: !gone },
                      { label: T('fx.reveal'), click: pick('reveal'), enabled: !gone },
                      { type: 'separator' },
                      { label: T('fx.copyFile'), click: pick('copyFile'), enabled: !gone },
                      { label: T('fx.copyPath'), click: pick('copyPath') },
                      { type: 'separator' },
                      { label: T('fx.showHistory'), click: pick('history') }
                  ];
            Menu.buildFromTemplate(template).popup({
                window: mainWindow,
                callback: () => setTimeout(pick(null), 80)
            });
        }).then(async action => {
            if (!action) return null;
            if (action === 'open') {
                const err = await shell.openPath(absOf(rt, rel));
                if (err) throw new Error(err);
            } else if (action === 'reveal') {
                shell.showItemInFolder(absOf(rt, rel));
            } else if (action === 'copyFile') {
                return { action, how: await copyFileToClipboard(absOf(rt, rel)) };
            } else if (action === 'copyPath') {
                clipboard.writeText(absOf(rt, rel));
            } else if (action === 'copyVersion') {
                return { action, how: await copyFileToClipboard(await versionTempFile(id, rel, opts.oid)) };
            }
            return { action };
        });
    });

    handle('file:copyToClipboard', async (id, rel, oid) => {
        const file = oid && oid !== 'working' ? await versionTempFile(id, rel, oid) : absOf(rtOf(id), rel);
        return copyFileToClipboard(file);
    });

    // Eski sürümü sürüklemeden önce geçici dosyayı hazırla (startDrag beklemeden çağrılmalı)
    handle('file:prepareDrag', async (id, rel, oid) => {
        if (oid && oid !== 'working') await versionTempFile(id, rel, oid);
        return true;
    });

    ipcMain.on('file:dragStart', async (event, { id, rel, oid } = {}) => {
        try {
            const file = oid && oid !== 'working' ? await versionTempFile(id, rel, oid) : absOf(rtOf(id), rel);
            if (!fs.existsSync(file)) return;
            event.sender.startDrag({ file, icon: dragIconImage() });
        } catch (e) {}
    });

    handle('files:add', async id => {
        const rt = rtOf(id);
        const r = await dialog.showOpenDialog(mainWindow, {
            title: T('fx.addDialog', { name: recordOf(id).name }),
            properties: ['openFile', 'multiSelections'],
            buttonLabel: T('fx.addBtn')
        });
        if (r.canceled || !r.filePaths.length) return null;
        return copyIntoProject(rt, r.filePaths);
    });

    handle('files:import', (id, paths) => copyIntoProject(rtOf(id), Array.isArray(paths) ? paths : []));

    // GitHub'dan proje aç: Belgeler/DraftRewind/<depo> içine indir, ayrı gitdir ile kaydet
    handle('project:importGithub', async input => {
        const importer = require('./core/importer');
        if (!importer.parseRepo(input)) throw new Error(T('imp.errBadLink'));
        let token = null;
        try { token = await freshGithubToken(); } catch (e) { token = githubToken(); }
        const id = crypto.randomBytes(6).toString('hex');
        const gitdir = path.join(app.getPath('userData'), 'depolar', `${id}.git`);
        let last = 0;
        const res = await importer.cloneFromGithub({
            input,
            baseDir: path.join(app.getPath('documents'), 'DraftRewind'),
            gitdir,
            token,
            onProgress: p => {
                const now = Date.now();
                if (now - last < 120 && p.total && p.loaded < p.total) return;
                last = now;
                emit('importProgress', p);
            }
        });
        const record = { id, name: res.repo, dir: res.dir, createdAt: Date.now() };
        store.set('projects', [...projects(), record]);
        store.set('activeId', id);
        const rt = await startProject(record);
        syncDrive(rt, 'star');
        return { id, name: record.name, dir: res.dir };
    });

    // Telefonu QR ile eşle: jeton yalnızca QR içinde, 3 dakika geçerli (asla günlüğe yazılmaz)
    handle('phone:pairQr', async () => {
        const token = await freshGithubToken();
        const user = store.get('githubUser');
        if (!token || !user || !user.login) throw new Error(T('qr.needGithub'));
        const expiresAt = Date.now() + 3 * 60 * 1000;
        const d = Buffer.from(JSON.stringify({ t: token, l: user.login, e: expiresAt }), 'utf8')
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const dataUrl = await require('qrcode').toDataURL(`draftrewind://pair?v=1&d=${d}`, { margin: 1, width: 320 });
        return { dataUrl, expiresAt };
    });
}

// ---------------------------------------------------------------------------
// Yerel yapay zekâ (isteğe bağlı, indirilebilir). Kapalıysa her şey kural tabanlı çalışır.
// ---------------------------------------------------------------------------
const AI_PROMPTS = {
    title: {
        tr: 'Sen bir tez ve ödev yazma asistanısın. Öğrencinin belgesindeki değişikliği anlatan KISA bir kayıt başlığı yaz. Kurallar: Türkçe, en fazla 10 kelime; sadece değişiklik metninde gerçekten yazanı anlat, bilgi uydurma; hangi bölüme ne eklendiğini/çıkarıldığını söyle; girdiyi aynen kopyalama; tırnak, emoji ve açıklama ekleme.',
        en: 'You are a thesis and homework writing assistant. Write a SHORT save-point title describing the change in the student\'s document. Rules: English, at most 10 words; describe only what is actually in the change text, never invent anything; say which section got what added or removed; do not copy the input verbatim; no quotes, no emojis, no explanation.'
    },
    change: {
        tr: 'Öğrencinin belgesindeki değişikliği EN FAZLA 2 kısa, sade Türkçe cümleyle anlat: ne eklendi, ne çıkarıldı. Sadece değişiklik metninde yazanı kullan, bilgi uydurma. Madde işareti, başlık ve emoji kullanma.',
        en: 'Explain the change in the student\'s document in AT MOST 2 short, plain English sentences: what was added, what was removed. Use only what is in the change text, never invent anything. No bullet points, headings or emojis.'
    },
    week: {
        tr: 'Öğrencinin son 7 günde tezinde/ödevinde yaptıklarını EN FAZLA 3 kısa cümlelik samimi ve motive edici bir Türkçe özetle anlat. İkinci tekil şahıs kullan ("bu hafta ... ekledin"). Sadece listede yazanı kullan, bilgi uydurma. Emoji kullanma.',
        en: 'Summarize what the student did on their thesis/homework in the last 7 days in AT MOST 3 short, warm, motivating English sentences. Use second person ("this week you added ..."). Use only what is in the list, never invent facts. No emojis.'
    }
};

async function aiTitle(digest) {
    if (!ai || !prefs().aiTitles || !ai.status().installed || !hasContent(digest)) return null;
    const lang = I18N.getLanguage() === 'tr' ? 'tr' : 'en';
    const text = await ai.complete({ system: AI_PROMPTS.title[lang], user: `${digest}\n\n${lang === 'tr' ? 'Başlık:' : 'Title:'}`, maxTokens: 40, temperature: 0.1 });
    const title = cleanTitle(text);
    return title && grounded(title, digest) ? title : null;
}

function aiError(e) {
    if (e && e.code === 'ECHECKSUM') return T('ai.errChecksum');
    if (e && e.code === 'ENOTINSTALLED') return T('ai.errNotInstalled');
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message))) return T('ai.errCancelled');
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT/i.test(String(e && e.message))) return T('ai.errNetwork');
    return T('ai.errGeneric');
}

function registerAiIpc() {
    handle('ai:install', async () => {
        try {
            await ai.installAll();
            return ai.status();
        } catch (e) {
            throw new Error(aiError(e));
        }
    });
    handle('ai:cancel', () => {
        ai.cancelInstall();
        return true;
    });
    handle('ai:remove', async () => {
        await ai.remove();
        return ai.status();
    });
    // Zaman makinesi: bir kayıttaki değişikliği sade dille özetle.
    // Model ham diff'i görmez: tüm diff kodla olgu kartına çevrilir (facts.js). Küçük değişiklik,
    // yeni/silinen dosya ve kod dosyası için model hiç çalışmaz; cevabı şüpheliyse şablon gösterilir.
    handle('ai:summarizeChange', async (id, rel, oid) => {
        const p = rtOf(id).project;
        const parent = oid === 'working' ? await p.head() : await p.parentOf(oid);
        const d = await p.diff(rel, parent, oid);
        if (!d.supported) throw new Error(T('ai.errUnsupportedFile'));
        const name = path.basename(rel);
        if (!d.existsAfter) return T('ai.tpl.deletedFile', { name });
        const added = [];
        const removed = [];
        const edited = [];
        const sections = [];
        let heading = null;
        for (const b of d.blocks) {
            const txt = b.text || '';
            if ((b.type === 'same' || b.type === 'add') && facts.looksHeading(txt)) heading = txt;
            if (b.type === 'add') added.push(txt);
            else if (b.type === 'del') removed.push(txt);
            else if (b.type === 'mod') {
                edited.push({
                    old: b.parts.filter(x => x.r).map(x => x.t).join(' ').trim(),
                    new: b.parts.filter(x => x.a).map(x => x.t).join(' ').trim()
                });
            } else continue;
            if (heading) sections.push(heading);
        }
        if (!added.length && !removed.length && !edited.length) return T('ai.tpl.noText');
        const f = facts.changeFacts({ added, removed, edited, sections });
        if (!d.existedBefore) {
            const words = f.addWords.toLocaleString(I18N.locale());
            return `${T('ai.tpl.newFile', { name })} (${words} ${I18N.getLanguage() === 'tr' ? 'kelime' : 'words'})` +
                (f.newHeads.length ? ' ' + T('ai.tpl.newSections', { list: f.newHeads.map(h => `“${h}”`).join(', ') }) : '');
        }
        if (facts.isCode(rel)) return T('ai.tpl.codeChanged', { add: added.length + edited.length, rem: removed.length + edited.length });
        const template = facts.templateChange(f, T, { added, removed, edited });
        if (f.small || (!f.addedSamples.length && !f.removedSamples.length && !f.edits.length)) return template;
        const card = facts.factsText(f, name);
        const lang = I18N.getLanguage() === 'tr' ? 'tr' : 'en';
        try {
            const out = await ai.complete({ system: AI_PROMPTS.change[lang], user: card, maxTokens: 90, temperature: 0.2 });
            return facts.vet(out, card) || template;
        } catch (e) {
            if (e && e.code === 'ENOTINSTALLED') throw new Error(aiError(e));
            return template;
        }
    });
    // Özet: son 7 günün kısa özeti. Modele en fazla 8 başlık + birkaç sayı gider.
    handle('ai:weekly', async id => {
        const list = (await fullHistory(rtOf(id))).filter(h => Date.now() - h.time < 7 * 24 * 3600 * 1000 && h.kind !== 'merge');
        if (!list.length) throw new Error(T('ai.errNoWeek'));
        const perFile = {};
        for (const h of list) for (const [p, w] of Object.entries(h.delta || {})) perFile[p] = (perFile[p] || 0) + w;
        const words = Object.values(perFile).reduce((a, b) => a + b, 0);
        const top = Object.entries(perFile).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
        const days = new Set(list.map(h => new Date(h.time).toDateString())).size;
        const template = top
            ? T('ai.tpl.week', { n: list.length, words: words.toLocaleString(I18N.locale()), file: path.basename(top[0]) })
            : T('ai.tpl.weekNoFile', { n: list.length, words: words.toLocaleString(I18N.locale()) });
        const titles = [];
        for (const h of list) {
            const t = facts.cut(h.title, 80);
            if (t && !titles.includes(t)) titles.push(t);
            if (titles.length >= 8) break;
        }
        const card =
            `Saves: ${list.length}. Active days: ${days}/7. Net words: ${words > 0 ? '+' : ''}${words}.\n` +
            (top ? `Most changed file: ${path.basename(top[0])}\n` : '') +
            titles.map(t => `- ${t}`).join('\n');
        const lang = I18N.getLanguage() === 'tr' ? 'tr' : 'en';
        try {
            const out = await ai.complete({ system: AI_PROMPTS.week[lang], user: card, maxTokens: 120, temperature: 0.3 });
            return facts.vet(out, null, 420) || template;
        } catch (e) {
            if (e && e.code === 'ENOTINSTALLED') throw new Error(aiError(e));
            return template;
        }
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
                    if (ai) ai.stop();
                    app.exit(0);
                }, Number(process.env.DRAFTREWIND_WAIT || 1500));
            }, 2500);
        });
    }
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    // Pencereye dönüldüğünde (en fazla dakikada bir) telefondan gelen değişiklikleri hemen al
    let lastFocusSync = 0;
    mainWindow.on('focus', () => {
        if (Date.now() - lastFocusSync < 60 * 1000) return;
        lastFocusSync = Date.now();
        for (const rt of runtimes.values()) if (!rt.syncing) runSync(rt);
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
    ai = new LocalAI(path.join(app.getPath('userData'), 'ai'), ev => emit(ev.type, ev));
    ai.cleanupOrphans();
    registerIpc();
    createWindow();
    createTray();
    applyAutostart();
    // Ücretsiz GitHub sürümü kendini günceller (Store sürümü ve geliştirme modu hariç)
    require('./core/updater').init({ app, emit, icon: iconPath() });

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
    // Telefondan veya başka bilgisayardan GitHub'a gelen değişiklikleri düzenli olarak al
    setInterval(() => {
        for (const rt of runtimes.values()) if (!rt.syncing) runSync(rt);
    }, config.GITHUB_POLL_MS);
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
    if (ai) ai.stop(); // yapay zekâ motorunu açık bırakma
    if (finalSnapshotDone || !store) return;
    e.preventDefault();
    finalSnapshotDone = true;
    Promise.race([snapshotAll('auto'), new Promise(r => setTimeout(r, 5000))]).finally(() => app.quit());
});

app.on('will-quit', () => {
    if (ai) ai.stop();
});

app.on('window-all-closed', () => {
    // Tepside çalışmaya devam et
});
