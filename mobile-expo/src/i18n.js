// Dil desteği (Türkçe / English). Dil tercihi: 'auto' | 'tr' | 'en'.
// 'auto' → cihaz dili Türkçe ise tr, değilse en.
import { getLocales } from 'expo-localization';
import { File, Paths } from 'expo-file-system';

const tr = {
  'common.cancel': 'Vazgeç',
  'common.done': 'Bitti',
  'common.close': 'Kapat',
  'common.connecting': 'Bağlanıyor…',
  'nav.projects': 'Projeler',

  'login.tagline': 'Tezin, ödevin, makalen: her hali cebinde. İstediğin an zamanı geri sar.',
  'login.github': '🐙  GitHub ile giriş yap',
  'login.google': '📁  Google Drive ile giriş yap',
  'login.hint': "Bilgisayardaki DraftRewind'da hangi hesabı bağladıysan onunla gir.",
  'login.googleNotConfigured': 'Google girişi bu sürümde yapılandırılmamış.',
  'code.copied': 'Kod kopyalandı. Açılan GitHub sayfasına yapıştır ve onayla:',
  'code.copyOpen': "📋 Kopyala ve GitHub'ı aç",
  'code.waiting': 'Onayını bekliyorum…',

  'settings.title': 'Ayarlar',
  'settings.accounts': 'HESAPLAR',
  'settings.language': 'DİL',
  'settings.theme': 'TEMA',
  'lang.auto': 'Otomatik',
  'theme.system': 'Sistem',
  'theme.light': 'Açık',
  'theme.dark': 'Koyu',
  'account.notConnected': 'Bağlı değil',
  'account.logout': 'Çıkış',
  'account.connect': 'Bağlan',

  'greet.night': 'İyi geceler 🌙',
  'greet.morning': 'Günaydın ☀️',
  'greet.day': 'İyi günler 🌤️',
  'greet.evening': 'İyi akşamlar 🌆',
  'home.hello': 'Merhaba {name}',
  'home.myProjects': 'Projelerim',
  'home.newSavesOne': '{name}: {count} yeni kayıt',
  'home.newSavesMany': '{n} projede yeni kayıtlar',
  'home.githubHeader': '🐙 GITHUB YEDEKLERİ',
  'home.lastBackup': 'Son yedek {ago}',
  'home.updated': 'Güncellendi {ago}',
  'home.emptyTitle': 'Henüz proje yok',
  'home.emptyBody':
    'Bilgisayarındaki DraftRewind\'da "Bulut & Telefon" sekmesinden GitHub veya Google Drive\'a bağlan. Projelerin birkaç dakika içinde burada belirir.',

  'pulse.titleOne': '{name}: {count} yeni kayıt',
  'pulse.titleMany': '{n} projede {count} yeni kayıt',
  'pulse.synced': 'Bilgisayarındaki çalışmalar eşitlendi',
  'pulse.newShort': '{count} yeni',
  'pulse.downloading': 'İndiriliyor…',
  'pulse.downloadingShort': 'İndiriliyor',
  'pulse.failed': 'İndirilemedi',
  'pulse.failedShort': 'Hata',
  'pulse.ready': 'Hazır, açabilirsin',
  'pulse.readyShort': 'Hazır',

  'focus.session': 'Yazma seansı',
  'focus.title': 'Odak modu',
  'focus.active': 'Odaklandın, yazmaya devam!',
  'focus.activeSub': 'Geri sayım Dinamik Ada ve kilit ekranında',
  'focus.idleSub': "Telefonu bırak, sayaç Dinamik Ada'da dursun",
  'focus.end': 'Bitir',
  'focus.minutes': '{n} dk',
  'focus.activityCaption': 'Odak modu · DraftRewind',
  'focus.activityLabel': 'Odak',

  'project.oldVersion': 'Eski sürüm',
  'project.current': 'Güncel hali',
  'project.whatChanged': 'Bu kayıtta neler değişti',
  'stats.streak': 'Seri',
  'stats.days': '{n} gün',
  'stats.today': 'Bugün',
  'stats.words': 'Kelime',
  'stats.thisWeek': 'Bu hafta',
  'tab.time': '🕰️ Zaman ({n})',
  'tab.docs': '📄 Belgeler ({n})',
  'words.count': '{n} kelime',

  'snapshot.changed': 'BU KAYITTA DEĞİŞENLER',
  'snapshot.removed': 'silindi',
  'snapshot.added': 'yeni dosya',
  'snapshot.modified': 'güncellendi',
  'snapshot.diff': '🔍 Neler değişti',
  'snapshot.thisVersion': '📄 Bu hali',
  'snapshot.noFiles': 'Dosya değişikliği yok — bu an işaretlenmiş.',

  'drive.versions': '🕰️ Sürümler',
  'drive.versionsSub': 'Tarihli kopyalar, en yenisi üstte',
  'drive.versionsFolder': '🕰️ Sürümler (eski halleri)',
  'drive.folder': 'Klasör',
  'drive.empty': 'Bu klasör boş.',

  'viewer.unsupported': 'Bu dosya türü telefonda gösterilemiyor.',
  'viewer.preparing': 'Sayfalar hazırlanıyor…',
  'viewer.preparingSheet': 'Tablo hazırlanıyor…',
  'viewer.downloading': 'İndiriliyor…',
  'viewer.failed': 'Belge gösterilemedi: ',
  'viewer.comparing': 'Karşılaştırılıyor…',
  'viewer.sameParagraphs': '⋯ {n} paragraf aynı ⋯',
  'viewer.firstVersion': 'İlk hali',
  'viewer.words': '{n} kelime',
  'viewer.unchanged': 'Metin değişmemiş (biçim veya düzen değişmiş olabilir).',
  'viewer.compareFailed': 'Karşılaştırılamadı: ',

  'time.never': 'henüz yok',
  'time.justNow': 'az önce',
  'time.minutesAgo': '{n} dk önce',
  'time.today': 'bugün {time}',
  'time.yesterday': 'dün {time}',
  'time.date': '{d} {month} {time}',
  'day.today': 'Bugün',
  'day.yesterday': 'Dün',
  'day.date': '{d} {month}',
  months: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  longMonths: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  days: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],

  'err.cancelled': 'İptal edildi',
  'err.denied': 'Giriş reddedildi.',
  'err.codeExpired': 'Kodun süresi doldu, tekrar dene.',
  'err.sessionExpired': 'Oturumun süresi dolmuş, tekrar giriş yap.',
  'err.github': 'GitHub hatası ({status})',
  'err.googleNotSet': 'Google girişi henüz ayarlanmadı.',
  'err.googleCancelled': 'Google girişi iptal edildi.',
  'err.googleIncomplete': 'Google girişi tamamlanmadı.',
  'err.googleToken': 'Google jetonu alınamadı.',
  'err.googleExpired': 'Google oturumu sona erdi, tekrar giriş yap.',
  'err.drive': 'Drive hatası ({status})',
};

const en = {
  'common.cancel': 'Cancel',
  'common.done': 'Done',
  'common.close': 'Close',
  'common.connecting': 'Connecting…',
  'nav.projects': 'Projects',

  'login.tagline': 'Your thesis, essays and papers, every version in your pocket. Never lose a draft. Rewind anytime.',
  'login.github': '🐙  Sign in with GitHub',
  'login.google': '📁  Sign in with Google Drive',
  'login.hint': 'Use the same account you connected in DraftRewind on your computer.',
  'login.googleNotConfigured': "Google sign-in isn't set up in this build.",
  'code.copied': 'Code copied. Paste it on the GitHub page that opens and approve:',
  'code.copyOpen': '📋 Copy & open GitHub',
  'code.waiting': 'Waiting for your approval…',

  'settings.title': 'Settings',
  'settings.accounts': 'ACCOUNTS',
  'settings.language': 'LANGUAGE',
  'settings.theme': 'THEME',
  'lang.auto': 'Auto',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'account.notConnected': 'Not connected',
  'account.logout': 'Sign out',
  'account.connect': 'Connect',

  'greet.night': 'Good night 🌙',
  'greet.morning': 'Good morning ☀️',
  'greet.day': 'Good afternoon 🌤️',
  'greet.evening': 'Good evening 🌆',
  'home.hello': 'Hi {name}',
  'home.myProjects': 'My projects',
  'home.newSavesOne': '{name}: {count} new saves',
  'home.newSavesOne_one': '{name}: 1 new save',
  'home.newSavesMany': 'New saves in {n} projects',
  'home.githubHeader': '🐙 GITHUB BACKUPS',
  'home.lastBackup': 'Last backup {ago}',
  'home.updated': 'Updated {ago}',
  'home.emptyTitle': 'No projects yet',
  'home.emptyBody':
    'In DraftRewind on your computer, open the "Cloud & Phone" tab and connect GitHub or Google Drive. Your projects will show up here within a few minutes.',

  'pulse.titleOne': '{name}: {count} new saves',
  'pulse.titleOne_one': '{name}: 1 new save',
  'pulse.titleMany': '{count} new saves in {n} projects',
  'pulse.synced': 'Your work from your computer is synced',
  'pulse.newShort': '{count} new',
  'pulse.downloading': 'Downloading…',
  'pulse.downloadingShort': 'Downloading',
  'pulse.failed': "Couldn't download",
  'pulse.failedShort': 'Error',
  'pulse.ready': 'Ready to open',
  'pulse.readyShort': 'Ready',

  'focus.session': 'Writing session',
  'focus.title': 'Focus mode',
  'focus.active': "You're in the zone. Keep writing!",
  'focus.activeSub': 'Countdown is on the Dynamic Island and Lock Screen',
  'focus.idleSub': 'Put your phone down, the timer lives on the Dynamic Island',
  'focus.end': 'End',
  'focus.minutes': '{n} min',
  'focus.activityCaption': 'Focus mode · DraftRewind',
  'focus.activityLabel': 'Focus',

  'project.oldVersion': 'Older version',
  'project.current': 'Current version',
  'project.whatChanged': 'What changed in this save',
  'stats.streak': 'Streak',
  'stats.days': '{n} days',
  'stats.days_one': '1 day',
  'stats.today': 'Today',
  'stats.words': 'Words',
  'stats.thisWeek': 'This week',
  'tab.time': '🕰️ Timeline ({n})',
  'tab.docs': '📄 Documents ({n})',
  'words.count': '{n} words',
  'words.count_one': '{n} word',

  'snapshot.changed': 'CHANGED IN THIS SAVE',
  'snapshot.removed': 'deleted',
  'snapshot.added': 'new file',
  'snapshot.modified': 'updated',
  'snapshot.diff': '🔍 What changed',
  'snapshot.thisVersion': '📄 This version',
  'snapshot.noFiles': 'No file changes. This moment was just marked.',

  'drive.versions': '🕰️ Versions',
  'drive.versionsSub': 'Dated copies, newest first',
  'drive.versionsFolder': '🕰️ Versions (older copies)',
  'drive.folder': 'Folder',
  'drive.empty': 'This folder is empty.',

  'viewer.unsupported': "This file type can't be shown on your phone.",
  'viewer.preparing': 'Preparing pages…',
  'viewer.preparingSheet': 'Preparing spreadsheet…',
  'viewer.downloading': 'Downloading…',
  'viewer.failed': "Couldn't show the document: ",
  'viewer.comparing': 'Comparing…',
  'viewer.sameParagraphs': '⋯ {n} unchanged paragraphs ⋯',
  'viewer.sameParagraphs_one': '⋯ 1 unchanged paragraph ⋯',
  'viewer.firstVersion': 'First version',
  'viewer.words': '{n} words',
  'viewer.words_one': '{n} word',
  'viewer.unchanged': "The text didn't change (formatting or layout may have).",
  'viewer.compareFailed': "Couldn't compare: ",

  'time.never': 'never',
  'time.justNow': 'just now',
  'time.minutesAgo': '{n} min ago',
  'time.today': 'today {time}',
  'time.yesterday': 'yesterday {time}',
  'time.date': '{month} {d}, {time}',
  'day.today': 'Today',
  'day.yesterday': 'Yesterday',
  'day.date': '{month} {d}',
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  longMonths: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],

  'err.cancelled': 'Cancelled',
  'err.denied': 'Sign-in was denied.',
  'err.codeExpired': 'The code expired. Please try again.',
  'err.sessionExpired': 'Your session expired. Please sign in again.',
  'err.github': 'GitHub error ({status})',
  'err.googleNotSet': "Google sign-in isn't set up yet.",
  'err.googleCancelled': 'Google sign-in was cancelled.',
  'err.googleIncomplete': "Google sign-in didn't complete.",
  'err.googleToken': "Couldn't get a Google token.",
  'err.googleExpired': 'Your Google session expired. Please sign in again.',
  'err.drive': 'Drive error ({status})',
};

const DICTS = { tr, en };

export function deviceLanguage() {
  try {
    const code = getLocales()[0].languageCode;
    return code === 'tr' ? 'tr' : 'en';
  } catch (e) {
    return 'en';
  }
}

let current = deviceLanguage();

// pref: 'auto' | 'tr' | 'en'; deviceCode: cihazın dil kodu (useLocales ile güncel tutulur)
export function resolveLanguage(pref, deviceCode) {
  if (pref === 'tr' || pref === 'en') return pref;
  if (deviceCode !== undefined) return deviceCode === 'tr' ? 'tr' : 'en';
  return deviceLanguage();
}

export function setLanguage(l) {
  current = l === 'tr' ? 'tr' : 'en';
}

export const lang = () => current;
export const locale = () => (current === 'tr' ? 'tr-TR' : 'en-US');

// t('home.hello', { name }) — {ad} yer tutucularını doldurur; vars.count === 1 ise varsa '_one' biçimini kullanır.
export function t(key, vars) {
  const d = DICTS[current];
  let s = vars && vars.count === 1 && d[key + '_one'] !== undefined ? d[key + '_one'] : d[key];
  if (s === undefined) s = tr[key] !== undefined ? tr[key] : key;
  if (typeof s !== 'string' || !vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

// WebView içindeki metinler (viewer.js'e parametre olarak geçer)
export function viewerLabels() {
  return {
    preparing: t('viewer.preparing'),
    preparingSheet: t('viewer.preparingSheet'),
    failed: t('viewer.failed'),
    comparing: t('viewer.comparing'),
    sameParagraphs: t('viewer.sameParagraphs'),
    sameParagraphsOne: t('viewer.sameParagraphs', { count: 1 }),
    firstVersion: t('viewer.firstVersion'),
    words: t('viewer.words'),
    wordsOne: t('viewer.words', { count: 1 }),
    unchanged: t('viewer.unchanged'),
    compareFailed: t('viewer.compareFailed'),
  };
}

// ---------------------------------------------------------------- tercihler
// Dil ve tema tercihi uygulamanın klasöründe küçük bir JSON dosyasında saklanır.
export const DEFAULT_PREFS = { language: 'auto', theme: 'system' };
const prefsFile = () => new File(Paths.document, 'ayarlar.json');

export function loadPrefs() {
  try {
    const f = prefsFile();
    if (!f.exists) return { ...DEFAULT_PREFS };
    const p = JSON.parse(f.textSync()) || {};
    return {
      language: ['auto', 'tr', 'en'].includes(p.language) ? p.language : DEFAULT_PREFS.language,
      theme: ['system', 'light', 'dark'].includes(p.theme) ? p.theme : DEFAULT_PREFS.theme,
    };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    prefsFile().write(JSON.stringify(prefs));
  } catch (e) {}
}
