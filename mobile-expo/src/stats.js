// Masaüstündeki istatistik hesabının aynısı (kayıtlardaki kelime toplamlarından).
import { t, locale } from './i18n';

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export function computeStats(history) {
  const chron = [...history].reverse();
  const dayLast = new Map();
  const active = new Set();
  for (const h of chron) {
    const k = dayKey(h.time);
    if (typeof h.total === 'number') dayLast.set(k, h.total);
    if (h.kind !== 'merge') active.add(k);
  }
  const perDay = new Map();
  let prev = null;
  for (const [k, total] of dayLast) {
    perDay.set(k, prev == null ? 0 : total - prev);
    prev = total;
  }
  const today = new Date();
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    week.push({ label: i === 0 ? t('stats.today') : t('days')[d.getDay()], words: Math.max(0, perDay.get(dayKey(d)) || 0) });
  }
  let streak = 0;
  for (let i = 0; i < 3650; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (active.has(dayKey(d))) streak++;
    else if (i > 0) break;
  }
  return {
    today: perDay.get(dayKey(today)) || 0,
    week,
    streak,
    total: history.length && typeof history[0].total === 'number' ? history[0].total : 0,
    snapshots: history.length,
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
