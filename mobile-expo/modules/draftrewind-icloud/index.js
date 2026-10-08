// Yerel "DraftrewindIcloud" Expo modülünün JS girişi (iCloud Drive kapsayıcısı).
// requireOptionalNativeModule, yerel taraf yoksa (Expo Go, Android, web, eski sürüm) null döner;
// buradaki her işlev o durumda "iCloud yok" der, asla hata fırlatmaz.
import { requireOptionalNativeModule } from 'expo';

let Native = null;
try {
  Native = requireOptionalNativeModule('DraftrewindIcloud');
} catch (e) {
  Native = null;
}

export const isNativeModuleLoaded = () => !!Native;

// Kullanıcı bu cihazda iCloud'a giriş yapmış mı?
export function icloudAvailable() {
  if (!Native || typeof Native.icloudAvailable !== 'function') return false;
  try {
    return !!Native.icloudAvailable();
  } catch (e) {
    return false;
  }
}

// <kapsayıcı>/Documents dosya yolu ya da null (yetki yok / giriş yok / iCloud Drive kapalı)
export async function icloudContainerPath() {
  if (!Native || typeof Native.icloudContainerPath !== 'function') return null;
  try {
    const p = await Native.icloudContainerPath();
    return typeof p === 'string' && p ? p : null;
  } catch (e) {
    return null;
  }
}

export async function startDownloading(path) {
  if (!Native || typeof Native.startDownloading !== 'function') return false;
  try {
    return !!(await Native.startDownloading(String(path)));
  } catch (e) {
    return false;
  }
}

export async function isDownloaded(path) {
  if (!Native || typeof Native.isDownloaded !== 'function') return false;
  try {
    return !!(await Native.isDownloaded(String(path)));
  } catch (e) {
    return false;
  }
}

export default { icloudAvailable, icloudContainerPath, startDownloading, isDownloaded, isNativeModuleLoaded };
