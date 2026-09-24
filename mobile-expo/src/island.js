// Dinamik Ada yardımcıları. Yerel modül yoksa (ör. Expo Go, eski iOS) her şey sessizce devre dışı kalır.
import { File, Paths } from 'expo-file-system';

let Activities = {};
try {
  Activities = require('./FocusActivity');
} catch (e) {}

let appGroupReady = () => false;
try {
  appGroupReady = require('../modules/draftrewind-ai').appGroupReady;
} catch (e) {}

// app.json → expo-widgets.groupIdentifier ile aynı olmalı
const APP_GROUP = 'group.com.draftrewind.app';

// Yan yükleme (ücretsiz Apple hesabı) App Group'u yeniden adlandırır; o zaman eklenti düzeni
// okuyamaz ve Dinamik Ada boş siyah bir hap olarak kalır. Grup erişilebilir değilse hiç başlatma
// ve önceki sürümden takılı kalmış boş etkinlikleri kapat.
const islandUsable = (() => {
  if (!Activities.PulseActivity) return false;
  let ok = false;
  try {
    ok = appGroupReady(APP_GROUP);
  } catch (e) {}
  if (!ok) {
    try {
      for (const a of Activities.PulseActivity.getInstances()) a.end('immediate').catch(() => {});
    } catch (e) {}
  }
  return ok;
})();

const PulseActivity = islandUsable ? Activities.PulseActivity : null;

let current = null;
let endTimer = null;

// Kısa süreli bildirim: başlar, `ms` sonra kendiliğinden kapanır.
// Dönen nesneyle içerik güncellenebilir (ör. "indiriliyor" → "hazır").
export function pulse(props, ms = 6000) {
  if (!PulseActivity) return { update() {}, finish() {} };
  try {
    clearTimeout(endTimer);
    if (current) current.end('immediate').catch(() => {});
    current = PulseActivity.start(props);
  } catch (e) {
    current = null;
  }
  const instance = current;
  const schedule = (after) => {
    clearTimeout(endTimer);
    endTimer = setTimeout(() => {
      if (instance) instance.end('immediate').catch(() => {});
      if (current === instance) current = null;
    }, after);
  };
  schedule(ms);
  return {
    update(next) {
      try {
        if (instance) instance.update({ ...props, ...next }).catch(() => {});
      } catch (e) {}
      schedule(ms);
    },
    finish(next, after = 3500) {
      try {
        if (instance && next) instance.update({ ...props, ...next }).catch(() => {});
      } catch (e) {}
      schedule(after);
    },
  };
}

// Son görülen durum (hangi projede en son neyi gördük) — yeni kayıt bildirimi için
const seenFile = () => new File(Paths.document, 'goruldu.json');

export function loadSeen() {
  try {
    const f = seenFile();
    return f.exists ? JSON.parse(f.textSync()) : {};
  } catch (e) {
    return {};
  }
}

export function saveSeen(seen) {
  try {
    seenFile().write(JSON.stringify(seen));
  } catch (e) {}
}

// Ana ekrandaki "yeni kayıtlar" kartı: kapatılana kadar (uygulama yeniden açılsa bile) kalır,
// kapatılınca silinir. Aynı kayıtlar tekrar gelmez çünkü "görüldü" durumu duyuru anında ilerletilir.
const newsFile = () => new File(Paths.document, 'yeni-kayitlar.json');

export function loadPendingNews() {
  try {
    const f = newsFile();
    const list = f.exists ? JSON.parse(f.textSync()) : null;
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) {
    return null;
  }
}

export function savePendingNews(list) {
  try {
    const f = newsFile();
    if (list && list.length) f.write(JSON.stringify(list));
    else if (f.exists) f.delete();
  } catch (e) {}
}
