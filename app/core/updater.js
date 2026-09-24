// Güncelleme: yalnızca GitHub'dan indirilen ücretsiz (NSIS) sürüm için. Microsoft Store sürümünü
// Store, iOS sürümünü App Store günceller (process.windowsStore === true → hiçbir şey yapma).
// Akış: açılışta ve 6 saatte bir GitHub Releases'e bakılır → yeni sürüm varsa kullanıcıya sorulur
// ("İndir ve kur" / "1 hafta ertele" / "Bu sürümü atla") → indirme kabul edilirse arka planda iner,
// bitince "Şimdi yeniden başlat" ya da "kapanınca kurulsun" seçilir. Hiçbir şey sormadan kurulmaz.
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const FEED = { provider: 'github', owner: 'heyobi', repo: 'draftrewind' };
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// app: electron app · emit: (type, payload) → arayüze olay · store: ayar deposu · beforeInstall: kurmadan önce kayıt
function init({ app, emit, icon, store, beforeInstall }) {
    if (!app.isPackaged || process.windowsStore || process.env.DRAFTREWIND_NO_UPDATE) return null;
    let autoUpdater;
    try {
        ({ autoUpdater } = require('electron-updater'));
        autoUpdater.setFeedURL(FEED);
    } catch (e) {
        console.warn('[DraftRewind] Güncelleyici başlatılamadı:', e.message);
        return null;
    }
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    const state = { available: null, downloading: false, downloaded: null, checking: false, manual: false };
    const send = payload => {
        try { emit('update', payload); } catch (e) {}
    };
    const notesText = info => {
        const n = info && info.releaseNotes;
        if (!n) return '';
        const raw = Array.isArray(n) ? n.map(x => (typeof x === 'string' ? x : x.note || '')).join('\n') : String(n);
        return raw.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500);
    };

    autoUpdater.on('update-available', info => {
        state.checking = false;
        const version = (info && info.version) || '';
        state.available = { version, notes: notesText(info) };
        const skipped = store.get('updateSkip', null);
        const snoozed = store.get('updateSnoozeUntil', 0);
        // Elle denetlemede atlanan/ertelenen sürüm de gösterilir
        if (!state.manual && (skipped === version || Date.now() < snoozed)) return;
        state.manual = false;
        send({ state: 'available', version, notes: state.available.notes });
    });
    autoUpdater.on('update-not-available', () => {
        state.checking = false;
        if (state.manual) {
            state.manual = false;
            send({ state: 'latest', version: app.getVersion() });
        }
    });
    autoUpdater.on('download-progress', p => {
        send({ state: 'downloading', percent: Math.round(p.percent || 0) });
    });
    autoUpdater.on('update-downloaded', info => {
        state.downloading = false;
        state.downloaded = (info && info.version) || state.available?.version || '';
        send({ state: 'downloaded', version: state.downloaded });
        try {
            const { Notification } = require('electron');
            new Notification({ title: T('update.readyTitle'), body: T('update.readyText', { version: state.downloaded }), icon }).show();
        } catch (e) {}
    });
    autoUpdater.on('error', e => {
        state.checking = false;
        state.downloading = false;
        console.warn('[DraftRewind] Güncelleme:', e && e.message);
        if (state.manual) {
            state.manual = false;
            send({ state: 'error', message: T('update.errNetwork') });
        }
    });

    const check = (manual = false) => {
        if (state.checking) return;
        if (state.downloaded) {
            if (manual) send({ state: 'downloaded', version: state.downloaded });
            return;
        }
        state.checking = true;
        state.manual = manual;
        try {
            const p = autoUpdater.checkForUpdates();
            if (p && p.catch) p.catch(() => {});
        } catch (e) {
            state.checking = false;
        }
    };

    // Arayüzden gelen kararlar
    const respond = action => {
        const v = state.available && state.available.version;
        if (action === 'download') {
            if (state.downloading || state.downloaded) return;
            state.downloading = true;
            store.set('updateSkip', null);
            store.set('updateSnoozeUntil', 0);
            send({ state: 'downloading', percent: 0 });
            try {
                const p = autoUpdater.downloadUpdate();
                if (p && p.catch) p.catch(() => {});
            } catch (e) {
                state.downloading = false;
            }
        } else if (action === 'snooze') {
            store.set('updateSnoozeUntil', Date.now() + SNOOZE_MS);
        } else if (action === 'skip' && v) {
            store.set('updateSkip', v);
        }
    };

    const install = async () => {
        if (!state.downloaded) return false;
        try {
            if (beforeInstall) await beforeInstall();
        } catch (e) {}
        app.isQuitting = true;
        setImmediate(() => autoUpdater.quitAndInstall(false, true));
        return true;
    };

    setTimeout(() => check(false), FIRST_CHECK_MS).unref?.();
    setInterval(() => check(false), CHECK_EVERY_MS).unref?.();
    return { check: () => check(true), respond, install, state };
}

module.exports = { init, FEED };
