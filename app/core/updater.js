// Otomatik güncelleme: yalnızca GitHub'dan indirilen ücretsiz (NSIS) sürüm için.
// Microsoft Store sürümünü Store günceller (process.windowsStore === true → hiçbir şey yapma).
// Güncelleme arka planda indirilir; uygulama kapanırken kurulur (autoInstallOnAppQuit).
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const FEED = { provider: 'github', owner: 'heyobi', repo: 'draftrewind' };
const FIRST_CHECK_MS = 30 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// app: electron app · emit: (type, payload) → arayüze olay · icon: bildirim simgesi yolu
function init({ app, emit, icon }) {
    if (!app.isPackaged || process.windowsStore || process.env.DRAFTREWIND_NO_UPDATE) return null;
    let autoUpdater;
    try {
        ({ autoUpdater } = require('electron-updater'));
        autoUpdater.setFeedURL(FEED);
    } catch (e) {
        console.warn('[DraftRewind] Güncelleyici başlatılamadı:', e.message);
        return null;
    }
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    let announced = null;
    autoUpdater.on('update-downloaded', info => {
        const version = (info && info.version) || '';
        if (announced === version) return;
        announced = version;
        const text = T('update.readyText', { version });
        try {
            emit('toast', { icon: 'gift', text });
        } catch (e) {}
        try {
            const { Notification } = require('electron');
            new Notification({ title: T('update.readyTitle'), body: text, icon }).show();
        } catch (e) {}
    });
    autoUpdater.on('error', e => console.warn('[DraftRewind] Güncelleme:', e && e.message));

    const check = () => {
        try {
            const p = autoUpdater.checkForUpdates();
            if (p && p.catch) p.catch(e => console.warn('[DraftRewind] Güncelleme kontrolü:', e && e.message));
        } catch (e) {}
    };
    setTimeout(check, FIRST_CHECK_MS).unref?.();
    setInterval(check, CHECK_EVERY_MS).unref?.();
    return autoUpdater;
}

module.exports = { init, FEED };
