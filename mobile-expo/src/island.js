// Dinamik Ada yardımcıları. Yerel modül yoksa (ör. Expo Go, eski iOS) her şey sessizce devre dışı kalır.
import { File, Paths } from 'expo-file-system';

let Activities = {};
try {
  Activities = require('./FocusActivity');
} catch (e) {}

export const FocusActivity = Activities.FocusActivity || null;
const PulseActivity = Activities.PulseActivity || null;

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
