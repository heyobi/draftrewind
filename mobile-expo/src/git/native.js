// Yerel git yardımcıları (modules/draftrewind-git): SHA-1 ve zlib arka plan kuyruğunda.
// Expo yerel modülleri globalThis.expo.modules altına kaydeder (requireOptionalNativeModule da oradan okur);
// Node testlerinde ve Expo Go'da yoktur → null, çağıranlar saf JS'e düşer.
import { plainBytes } from '../bytes.js';

const mods = globalThis.expo && globalThis.expo.modules;
const Native = mods && mods.DraftrewindGit ? mods.DraftrewindGit : null;

export const nativeGit = Native && typeof Native.deflate === 'function' ? Native : null;

// Yerel modüle yalnızca düz Uint8Array verilir (Buffer gibi alt sınıflar yerel kodu çökertir)
export const toNative = (b) => {
  const u = plainBytes(b);
  return u instanceof Uint8Array ? u : new Uint8Array(u);
};
