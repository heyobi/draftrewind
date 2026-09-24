// Belge paylaşma (WhatsApp, Mail, AirDrop, Dosyalar'a kaydet…) ve telefondan dosya seçme.
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { arrayBufferToBase64 } from './viewer';
import { t } from './i18n';

export const MAX_UPLOAD = 50 * 1024 * 1024;
// Masaüstü dosyaları yola göre eşleştirir: klasör adı her dilde aynı kalmalı.
export const PHONE_FOLDER = 'Telefondan eklenenler';

// uzantı → [MIME türü, iOS UTI]
const TYPES = {
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'org.openxmlformats.wordprocessingml.document'],
  docm: ['application/vnd.ms-word.document.macroEnabled.12', 'org.openxmlformats.wordprocessingml.document'],
  dotx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.template', 'org.openxmlformats.wordprocessingml.template'],
  doc: ['application/msword', 'com.microsoft.word.doc'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'org.openxmlformats.spreadsheetml.sheet'],
  xlsm: ['application/vnd.ms-excel.sheet.macroEnabled.12', 'org.openxmlformats.spreadsheetml.sheet'],
  xls: ['application/vnd.ms-excel', 'com.microsoft.excel.xls'],
  csv: ['text/csv', 'public.comma-separated-values-text'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'org.openxmlformats.presentationml.presentation'],
  pdf: ['application/pdf', 'com.adobe.pdf'],
  txt: ['text/plain', 'public.plain-text'],
  md: ['text/markdown', 'net.daringfireball.markdown'],
  tex: ['application/x-tex', 'public.plain-text'],
  bib: ['text/plain', 'public.plain-text'],
  json: ['application/json', 'public.json'],
  png: ['image/png', 'public.png'],
  jpg: ['image/jpeg', 'public.jpeg'],
  jpeg: ['image/jpeg', 'public.jpeg'],
  gif: ['image/gif', 'com.compuserve.gif'],
  webp: ['image/webp', 'org.webmproject.webp'],
  heic: ['image/heic', 'public.heic'],
  zip: ['application/zip', 'public.zip-archive'],
};

export function fileType(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  const [mimeType, UTI] = TYPES[ext] || ['application/octet-stream', 'public.data'];
  return { mimeType, UTI };
}

// Dosya adı için güvenli hale getir (iOS'ta / ve : kullanılamaz)
export function safeName(name) {
  const n = String(name || '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-').trim();
  return n || 'belge';
}

// "Tez.docx" → "Tez (2).docx" … taken(name) true oldukça sayı artar
export async function uniqueName(name, taken) {
  if (!(await taken(name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) {
    const next = `${base} (${i})${ext}`;
    if (!(await taken(next))) return next;
  }
  return `${base} (${Date.now()})${ext}`;
}

// İndirilen belgeyi gerçek adıyla önbelleğe yazar ve iOS paylaşım sayfasını açar.
export async function shareBuffer(name, buf) {
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('doc.shareUnavailable'));
  const root = new Directory(Paths.cache, 'Paylas');
  // Önceki paylaşımlardan kalan kopyaları temizle (paylaşım sayfası kapanmış olur)
  try {
    if (root.exists) root.delete();
  } catch (e) {}
  const dir = new Directory(root, String(Date.now()));
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, safeName(name));
  file.write(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const { mimeType, UTI } = fileType(name);
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: name });
}

// Belge seçici (birden çok dosya). Seçilenler önbelleğe kopyalanır.
export async function pickFiles() {
  const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: '*/*' });
  if (res.canceled || !res.assets) return [];
  return res.assets.map((a) => {
    let size = a.size;
    if (size == null) {
      try {
        size = new File(a.uri).size;
      } catch (e) {}
    }
    // Boyutu öğrenilemeyen dosya (ör. bazı sağlayıcılar) belleğe alınmaz: sınırı aşmış sayılır
    const unknown = size == null;
    return { uri: a.uri, name: a.name || a.uri.split('/').pop(), size: unknown ? MAX_UPLOAD + 1 : size, sizeUnknown: unknown, mimeType: a.mimeType };
  });
}

// ---------------------------------------------------------------- fotoğraf
let ImagePicker = null;
try {
  ImagePicker = require('expo-image-picker');
} catch (e) {
  ImagePicker = null;
}

// "Foto 2026-09-25 14.05.jpg" (aynı dakikada ikinci fotoğraf uniqueName ile "(2)" alır)
export function photoName(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Foto ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.jpg`;
}

// Seçici sonucunu pickFiles ile aynı biçime çevirir
function photoAsset(a, name) {
  let size = a.fileSize;
  if (size == null) {
    try {
      size = new File(a.uri).size;
    } catch (e) {}
  }
  const unknown = size == null;
  return { uri: a.uri, name, size: unknown ? MAX_UPLOAD + 1 : size, sizeUnknown: unknown, mimeType: a.mimeType || 'image/jpeg' };
}

const PHOTO_OPTS = { mediaTypes: ['images'], allowsEditing: false, quality: 0.8, base64: false, exif: false };

// Kamera: bir fotoğraf çeker; askMore() true dedikçe bir tane daha. Kamera izni yoksa { denied: true } fırlatır.
export async function takePhotos(askMore) {
  if (!ImagePicker) throw new Error(t('upload.cameraUnavailable'));
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm || !perm.granted) {
    const e = new Error(t('upload.cameraDenied'));
    e.denied = true;
    throw e;
  }
  const out = [];
  for (;;) {
    const res = await ImagePicker.launchCameraAsync(PHOTO_OPTS);
    if (!res.canceled && res.assets && res.assets[0]) out.push(photoAsset(res.assets[0], photoName()));
    if (res.canceled || !(await askMore(out.length))) break;
  }
  return out;
}

// Galeri: birden çok fotoğraf. (iOS'ta sistem seçici izin istemez.)
export async function pickPhotos() {
  if (!ImagePicker) throw new Error(t('upload.cameraUnavailable'));
  const res = await ImagePicker.launchImageLibraryAsync({ ...PHOTO_OPTS, allowsMultipleSelection: true, selectionLimit: 20 });
  if (res.canceled || !res.assets) return [];
  const stamp = new Date();
  return res.assets.map((a, i) => photoAsset(a, photoName(new Date(stamp.getTime() + i * 60000))));
}

export async function readBytes(asset) {
  return new File(asset.uri).bytes();
}

// base64: önce yerel (hızlı) kodlayıcı, olmazsa JS'de parça parça
export async function readBase64(asset) {
  const f = new File(asset.uri);
  try {
    return await f.base64();
  } catch (e) {
    return arrayBufferToBase64(await f.bytes());
  }
}

// Seçilen dosyanın önbellekteki kopyasını sil
export function discardPicked(asset) {
  try {
    const f = new File(asset.uri);
    if (f.exists) f.delete();
  } catch (e) {}
}

export const mb = (bytes) => (Math.round((bytes / (1024 * 1024)) * 10) / 10).toString();
