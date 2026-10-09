// Sorun bildirme: son hatalar bu cihazda küçük bir dosyada tutulur (sunucu yok, hiçbir yere kendiliğinden
// gitmez). Ayarlar › Gelişmiş › Sorun bildir, sürüm bilgisi ve bu hatalarla bir rapor hazırlar; kullanıcı
// paylaşım sayfasıyla (ör. e-posta) kendisi gönderir.
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const MAX = 40;
const logFile = () => new File(Paths.cache, 'dr-errors.json');

function readLog() {
  try {
    const f = logFile();
    return f.exists ? JSON.parse(f.textSync()) || [] : [];
  } catch (e) {
    return [];
  }
}

// where: hatanın geldiği yer (ör. 'fatal', 'sync'); jeton gibi gizli bilgiler mesajdan ayıklanır
export function recordError(err, where = 'error') {
  try {
    const clean = (s) => String(s || '').replace(/(gh[opusr]_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9._-]{20,}|Bearer\s+\S+)/g, '[gizli]');
    const list = readLog();
    list.unshift({
      at: Date.now(),
      where,
      msg: clean(err && err.message ? err.message : err).slice(0, 500),
      stack: clean(err && err.stack ? err.stack : '').split('\n').slice(0, 6).join('\n'),
    });
    logFile().write(JSON.stringify(list.slice(0, MAX)));
  } catch (e) {}
}

// Yakalanmamış JS hataları da kaydedilir (önceki işleyici aynen çalışmaya devam eder)
export function installErrorLog() {
  const EU = global.ErrorUtils;
  if (!EU || typeof EU.setGlobalHandler !== 'function') return;
  const prev = EU.getGlobalHandler && EU.getGlobalHandler();
  EU.setGlobalHandler((e, fatal) => {
    recordError(e, fatal ? 'fatal' : 'error');
    if (prev) prev(e, fatal);
  });
}

export function buildReport({ version, extra = [] } = {}) {
  const lines = [
    `DraftRewind sorun raporu · ${new Date().toISOString()}`,
    `Sürüm: ${version || '?'} · ${Platform.OS} ${Platform.Version}${Platform.isPad ? ' (iPad)' : ''}`,
    ...extra,
    '',
  ];
  const log = readLog();
  if (!log.length) lines.push('Kayıtlı hata yok.');
  for (const x of log.slice(0, 20)) {
    lines.push(`[${new Date(x.at).toISOString()}] ${x.where}: ${x.msg}`);
    if (x.stack) lines.push(x.stack.split('\n').map((l) => `    ${l}`).join('\n'));
  }
  return lines.join('\n');
}

export function clearLog() {
  try {
    const f = logFile();
    if (f.exists) f.delete();
  } catch (e) {}
}
