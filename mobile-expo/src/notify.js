// Yerel bildirimler (expo-notifications). Sunucu yok, push jetonu yok: her şey cihazda oluşur.
// Modül yüklenemezse (ör. eski derleme) her işlev sessizce "yapılamadı" döner; uygulama çökmez.
import { File, Paths } from 'expo-file-system';
import { t } from './i18n';

let N = null;
try {
  N = require('expo-notifications');
} catch (e) {
  N = null;
}

// Uygulama açıkken gelen bildirim de afiş olarak görünsün
try {
  if (N && N.setNotificationHandler) {
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  }
} catch (e) {}

const STALE_ID = 'backup-stale';

export const notificationsAvailable = () => !!(N && N.scheduleNotificationAsync);

// İzin var mı? Yoksa ister. Dönen: true (izin var) | false (reddedildi ya da modül yok)
export async function ensurePermission() {
  if (!notificationsAvailable()) return false;
  try {
    const cur = await N.getPermissionsAsync();
    if (cur && cur.granted) return true;
    const res = await N.requestPermissionsAsync();
    return !!(res && res.granted);
  } catch (e) {
    return false;
  }
}

// Hemen gösterilen tek seferlik bildirim
export async function notifyNow(id, title, body) {
  if (!notificationsAvailable()) return false;
  try {
    await N.scheduleNotificationAsync({ identifier: id, content: { title, body, sound: false }, trigger: null });
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------- yedek sağlığı
// "3 gündür yeni kayıt yok" kontrolü: kart o gün için kapatılabilir, bildirim en fazla 12 saatte bir.
export const STALE_DAYS = 3;
const NOTIFY_EVERY = 12 * 3600 * 1000;
const healthFile = () => new File(Paths.document, 'yedek-uyari.json');

function loadHealth() {
  try {
    const f = healthFile();
    return f.exists ? JSON.parse(f.textSync()) || {} : {};
  } catch (e) {
    return {};
  }
}

function saveHealth(h) {
  try {
    healthFile().write(JSON.stringify(h));
  } catch (e) {}
}

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// newest: projeler arasındaki en yeni kayıt zamanı (ms). Dönen: { stale, showCard, newest }
// notifyEnabled: "Yedek uyarıları" tercihi. Bildirim yalnızca 12 saat geçtiyse ve izin varsa gider
// (izin ilk gerektiğinde istenir).
export async function checkBackupHealth(newest, notifyEnabled) {
  if (!newest) return { stale: false, showCard: false, newest };
  const stale = Date.now() - newest > STALE_DAYS * 86400000;
  if (!stale) return { stale: false, showCard: false, newest };
  const h = loadHealth();
  const showCard = h.dismissedDay !== dayKey();
  if (notifyEnabled && Date.now() - (h.lastNotified || 0) > NOTIFY_EVERY) {
    // Zaman damgası izin sonucundan bağımsız ilerler: reddedildiyse her açılışta yeniden sorulmaz
    saveHealth({ ...h, lastNotified: Date.now() });
    if (await ensurePermission()) await notifyNow(STALE_ID, t('notify.staleTitle'), t('notify.staleBody'));
  }
  return { stale, showCard, newest };
}

// Kart o gün için kapatıldı (ertesi gün hâlâ kayıt yoksa yeniden görünür)
export function dismissBackupCard() {
  saveHealth({ ...loadHealth(), dismissedDay: dayKey() });
}
