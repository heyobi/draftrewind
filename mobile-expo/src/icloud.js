// iCloud Drive: uygulamanın kapsayıcısı (iCloud.com.draftrewind.app/Documents). Kapsayıcı yolu
// çözülebiliyorsa iCloud "bağlı" sayılır. Dosyalar indirilmemiş yer tutucu olabilir: okumadan önce
// ensureDownloaded ile indirilmesi beklenir (en fazla ~20 sn).
import { Directory } from 'expo-file-system';
import * as Native from '../modules/draftrewind-icloud';

export const icloudAvailable = () => Native.icloudAvailable();

// Dosya yolunu expo-file-system'in anladığı file:// adresine çevirir ("Mobile Documents" gibi boşluklar)
export const pathToUri = (path) => 'file://' + String(path).split('/').map(encodeURIComponent).join('/');
export const uriToPath = (uri) => {
  const raw = String(uri).replace(/^file:\/\//i, '');
  try {
    return decodeURIComponent(raw);
  } catch (e) {
    return raw;
  }
};

// Kapsayıcı yolu kısa süre önbelleklenir (her ekranda yerel çağrı yapılmasın); force ile tazelenir
let cache = { at: 0, path: null, job: null };
const TTL = 30 * 1000;
export async function containerPath(force = false) {
  if (!force && cache.at && Date.now() - cache.at < TTL) return cache.path;
  if (cache.job) return cache.job;
  cache.job = (async () => {
    // Giriş yoksa yerel tarafa hiç sorma
    const path = Native.icloudAvailable() ? await Native.icloudContainerPath() : null;
    cache = { at: Date.now(), path, job: null };
    return path;
  })();
  return cache.job;
}

// <kapsayıcı>/Documents dizini ya da null
export async function containerDir(force = false) {
  const path = await containerPath(force);
  return path ? new Directory(pathToUri(path)) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// iCloud dosyasının bu cihaza inmesini bekler. true: okunabilir. Zaman aşımında dosya yerelde varsa
// (eski bir hali bile) okunabilir sayılır; hiç yoksa false.
export async function ensureDownloaded(file, timeoutMs = 20000) {
  const path = uriToPath(file.uri);
  if (await Native.isDownloaded(path)) return true;
  await Native.startDownloading(path);
  const until = Date.now() + timeoutMs;
  let wait = 250;
  while (Date.now() < until) {
    await sleep(wait);
    wait = Math.min(1500, wait * 1.6);
    if (await Native.isDownloaded(path)) return true;
  }
  try {
    return file.exists;
  } catch (e) {
    return false;
  }
}

// İndirilmemiş öğe için indirmeyi başlatır, beklemez (liste taramasında)
export function nudgeDownload(file) {
  Native.startDownloading(uriToPath(file.uri)).catch(() => {});
}
