// Masaüstündeki istatistik hesabının aynısı (kayıtlardaki kelime toplamlarından).
import { t, locale } from './i18n';

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

// Masaüstünün yazma dışı kayıt türleri: birleştirme ve telefondan eklenen dosyalar seriyi etkilemez
const isWriting = (h) => h.kind !== 'merge' && h.kind !== 'mobile';
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Gün başına net kelime değişimi (günün son toplamı − önceki günün son toplamı) ve aktif günler
function daily(history) {
  const chron = [...history].reverse();
  const dayLast = new Map();
  const active = new Set();
  for (const h of chron) {
    const k = dayKey(h.time);
    if (typeof h.total === 'number') dayLast.set(k, h.total);
    if (isWriting(h)) active.add(k);
  }
  const perDay = new Map();
  let prev = null;
  for (const [k, total] of dayLast) {
    perDay.set(k, prev == null ? 0 : total - prev);
    prev = total;
  }
  return { perDay, active };
}

function currentStreak(active, today) {
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    if (active.has(dayKey(addDays(today, -i)))) streak++;
    else if (i > 0) break;
  }
  return streak;
}

// En son kelime toplamı (telefondan eklenen dosya kayıtlarında toplam yok, onları atla)
export const latestTotal = (history) => {
  const h = history.find((x) => typeof x.total === 'number');
  return h ? h.total : 0;
};
export const latestWords = (history) => {
  const h = history.find((x) => x.words && typeof x.words === 'object');
  return h ? h.words : {};
};

export function computeStats(history) {
  const { perDay, active } = daily(history);
  const today = new Date();
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    week.push({ label: i === 0 ? t('stats.today') : t('days')[d.getDay()], words: Math.max(0, perDay.get(dayKey(d)) || 0) });
  }
  return {
    today: perDay.get(dayKey(today)) || 0,
    week,
    streak: currentStreak(active, today),
    total: latestTotal(history),
    snapshots: history.length,
  };
}

// İstatistik sayfası için ayrıntılı hesap. weekStart: 1 = Pazartesi (tr), 0 = Pazar (en)
export function deepStats(history, { now = new Date(), weeks = 16, weekStart = 1 } = {}) {
  const { perDay, active } = daily(history);
  const today = startOfDay(now);
  const wordsOn = (d) => Math.max(0, perDay.get(dayKey(d)) || 0);

  // Isı haritası: sütun = hafta, satır = haftanın günü
  const offset = (today.getDay() - weekStart + 7) % 7;
  const first = addDays(today, -offset - (weeks - 1) * 7);
  const columns = [];
  let max = 0;
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let r = 0; r < 7; r++) {
      const d = addDays(first, w * 7 + r);
      if (d > today) {
        cells.push(null);
        continue;
      }
      const words = wordsOn(d);
      max = Math.max(max, words);
      cells.push({ time: d.getTime(), words, active: active.has(dayKey(d)) });
    }
    columns.push({ month: addDays(first, w * 7).getMonth(), cells });
  }
  for (const col of columns)
    for (const c of col.cells) {
      if (!c) continue;
      // 0: boş, 1: kayıt var / az yazı … 4: en yoğun günler
      c.level = c.words > 0 ? Math.min(4, Math.max(1, Math.ceil((c.words / (max || 1)) * 4))) : c.active ? 1 : 0;
    }
  columns.forEach((col, i) => (col.showMonth = i === 0 || col.month !== columns[i - 1].month));

  // Son 30 gün
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    last30.push({ time: d.getTime(), words: wordsOn(d) });
  }

  // En uzun seri
  const activeDays = [...active].map((k) => {
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  });
  activeDays.sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prevDay = null;
  for (const time of activeDays) {
    run = prevDay != null && Math.round((time - prevDay) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prevDay = time;
  }

  // En verimli gün
  let bestDay = null;
  for (const [k, words] of perDay) {
    if (words > 0 && (!bestDay || words > bestDay.words)) {
      const [y, m, d] = k.split('-').map(Number);
      bestDay = { time: new Date(y, m - 1, d).getTime(), words };
    }
  }

  // Saatlere göre: eklenen kelime (yoksa kayıt sayısı)
  const hourWords = new Array(24).fill(0);
  const hourSaves = new Array(24).fill(0);
  let nightOwl = false;
  let earlyBird = false;
  for (const h of history) {
    if (!isWriting(h)) continue;
    const hour = new Date(h.time).getHours();
    hourSaves[hour]++;
    hourWords[hour] += Object.values(h.delta || {}).reduce((a, b) => a + Math.max(0, b), 0);
    if (hour < 5) nightOwl = true;
    if (hour >= 5 && hour < 8) earlyBird = true;
  }
  const argmax = (arr) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);
  const bestHour = hourWords.some((v) => v > 0) ? argmax(hourWords) : hourSaves.some((v) => v > 0) ? argmax(hourSaves) : null;

  let positive = 0;
  for (const v of perDay.values()) positive += Math.max(0, v);
  const avgActive = active.size ? Math.round(positive / active.size) : 0;

  const total = latestTotal(history);
  const words = latestWords(history);
  const perFile = Object.entries(words)
    .map(([path, n]) => ({ path, words: n }))
    .filter((f) => f.words > 0)
    .sort((a, b) => b.words - a.words);
  const milestones = history.filter((h) => h.kind === 'star').map((h) => ({ oid: h.oid, title: h.title, note: h.note, time: h.time }));
  const streak = currentStreak(active, today);

  // icon: SF Symbol adı (App.js'te Icon ile çizilir)
  const badges = [
    { id: 'first1k', icon: 'leaf.fill', done: total >= 1000 },
    { id: 'streak7', icon: 'flame.fill', done: best >= 7 },
    { id: 'bigDay', icon: 'bolt.fill', done: !!bestDay && bestDay.words >= 1000 },
    { id: '10k', icon: 'trophy.fill', done: total >= 10000 },
    { id: 'star', icon: 'star.fill', done: milestones.length > 0 },
    { id: 'night', icon: 'moon.stars.fill', done: nightOwl },
    { id: 'early', icon: 'sunrise.fill', done: earlyBird },
    { id: 'saves100', icon: 'checkmark.seal.fill', done: history.filter(isWriting).length >= 100 },
  ];

  return {
    columns,
    last30,
    streak,
    bestStreak: Math.max(best, streak),
    bestDay,
    bestHour,
    avgActive,
    saves: history.length,
    total,
    perFile,
    milestones,
    badges,
  };
}

const pad = (n) => String(n).padStart(2, '0');
export const hm = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function same(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function ago(time) {
  if (!time) return t('time.never');
  const s = (Date.now() - time) / 1000;
  if (s < 45) return t('time.justNow');
  if (s < 3600) return t('time.minutesAgo', { n: Math.round(s / 60) });
  const d = new Date(time);
  const now = new Date();
  if (same(d, now)) return t('time.today', { time: hm(time) });
  if (same(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('time.yesterday', { time: hm(time) });
  return t('time.date', { d: d.getDate(), month: t('months')[d.getMonth()], time: hm(time) });
}

export function dayLabel(time) {
  const d = new Date(time);
  const now = new Date();
  if (same(d, now)) return t('day.today');
  if (same(d, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('day.yesterday');
  return t('day.date', { d: d.getDate(), month: t('longMonths')[d.getMonth()] });
}

export const num = (n) => Number(n || 0).toLocaleString(locale());

export function kindOf(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (['docx', 'docm', 'dotx'].includes(ext)) return 'word';
  if (['xlsx', 'xlsm', 'xls', 'csv'].includes(ext)) return 'sheet';
  if (ext === 'pptx') return 'slides';
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['txt', 'md', 'tex', 'bib', 'json', 'r', 'py', 'm', 'yaml', 'yml'].includes(ext)) return 'text';
  return 'other';
}
