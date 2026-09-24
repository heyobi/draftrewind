// Görüntüleyici kütüphaneleri uygulamanın içinde gelir (assets/viewer/*.txt):
// belge görüntüleme çevrimdışı çalışır ve hiçbir üçüncü taraf sunucuya istek gitmez.
// Metin olarak okunur, bellekte tutulur ve viewer.js tarafından HTML'e <script> olarak gömülür.
import { Image } from 'react-native';
import { File } from 'expo-file-system';

const MODULES = {
  jszip: require('../assets/viewer/jszip.min.txt'),
  docx: require('../assets/viewer/docx-preview.min.txt'),
  xlsx: require('../assets/viewer/xlsx.full.min.txt'),
  diff: require('../assets/viewer/diff.min.txt'),
};

const cache = {};

async function readText(uri) {
  // Geliştirme sunucusunda http(s), yayın sürümünde uygulama paketindeki file:// dosyası
  if (!/^https?:/i.test(uri)) {
    try {
      return await new File(uri).text();
    } catch (e) {}
  }
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`asset ${res.status}`);
  return res.text();
}

function loadOne(name) {
  if (!cache[name]) {
    cache[name] = (async () => {
      const src = Image.resolveAssetSource(MODULES[name]);
      if (!src || !src.uri) throw new Error(`asset ${name}`);
      return readText(src.uri);
    })().catch((e) => {
      delete cache[name]; // bir dahaki sefere yeniden dene
      throw e;
    });
  }
  return cache[name];
}

// names: ['jszip', 'docx'] → { jszip: '...', docx: '...' }
export async function loadViewerLibs(names) {
  const texts = await Promise.all(names.map(loadOne));
  const out = {};
  names.forEach((n, i) => (out[n] = texts[i]));
  return out;
}

// Hangi görünüm için hangi kütüphaneler gerekli
export const LIBS_FOR = {
  word: ['jszip', 'docx'],
  sheet: ['xlsx'],
  diff: ['jszip', 'diff'],
};
