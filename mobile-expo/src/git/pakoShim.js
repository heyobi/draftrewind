// isomorphic-git için pako: tek parça deflate yerel modülde (arka plan kuyruğu, arayüz donmaz);
// akış sınıfları (Inflate, Deflate) ve geri kalanı gerçek pako. metro.config.js yalnızca isomorphic-git'in
// "pako" isteğini buraya yönlendirir. isomorphic-git bu iki işlevi async bir işlevin içinden döndürdüğü
// için Promise dönmesi sorun değildir.
// Güvenlik: yerel yol ilk kullanımda pako ile iki yönlü sınanır; en ufak uyumsuzlukta kapatılır (git
// nesneleri asla yanlış sıkıştırılmaz).
import pako from 'pako';
import { nativeGit, toNative } from './native.js';

let status = nativeGit ? 'unknown' : 'off';
let checking = null;

const same = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

async function check() {
  try {
    const sample = new Uint8Array(70000);
    for (let i = 0; i < sample.length; i++) sample[i] = (i * 7 + (i >> 5)) & 255;
    sample.set([98, 108, 111, 98, 32], 0); // "blob "
    const d = new Uint8Array(await nativeGit.deflate(sample));
    if (!same(pako.inflate(d), sample)) throw new Error('deflate');
    const i = new Uint8Array(await nativeGit.inflate(pako.deflate(sample)));
    if (!same(i, sample)) throw new Error('inflate');
    const empty = new Uint8Array(await nativeGit.inflate(pako.deflate(new Uint8Array(0))));
    if (empty.length !== 0) throw new Error('empty');
    status = 'on';
  } catch (e) {
    status = 'off';
  }
}

const ready = async () => {
  if (status === 'unknown') await (checking || (checking = check()));
  return status === 'on';
};

// Ayarlar › Gelişmiş › Senkron motoru testi raporu için
export async function nativeZlibStatus() {
  if (!nativeGit) return 'yok';
  return (await ready()) ? 'açık' : 'kapalı (sınama başarısız)';
}

const shim = { ...pako };
shim.deflate = async (buffer) => ((await ready()) ? new Uint8Array(await nativeGit.deflate(toNative(buffer))) : pako.deflate(buffer));
// Açma (inflate) JS'te kalır: isomorphic-git paketteki bir nesneyi açarken paketin o noktadan SONRAKİ
// tamamını verir ve açıcının akışın bittiği yerde durmasını bekler (pako böyle yapar). Yerel açıcıya bu
// biçimde veri vermek hem yanlış (akış sonu bilinmez) hem de çok yavaş (her nesnede paketin kalanı kopyalanır).
shim.inflate = (buffer) => pako.inflate(buffer);

export default shim;
