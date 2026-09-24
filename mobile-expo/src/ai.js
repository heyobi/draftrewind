// Cihaz üstü Apple Intelligence (iOS 26+) özellikleri: belge özeti, "neler değişti?", "haftam".
// Hepsi telefonda çalışır; hiçbir metin sunucuya gitmez. Yerel modül yoksa/uygun değilse sessizce gizlenir.
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as AI from '../modules/draftrewind-ai';
import { t, lang } from './i18n';

// ------------------------------------------------------------------ uygunluk
let status = null; // son bilinen durum
let statusAt = 0;
let statusJob = null;
const listeners = new Set();

function refreshStatus(force) {
  if (!force && statusJob) return statusJob;
  if (!force && status && Date.now() - statusAt < 60000) return Promise.resolve(status);
  statusJob = AI.availability()
    .then((s) => {
      const changed = s !== status;
      status = s;
      statusAt = Date.now();
      if (changed) listeners.forEach((fn) => fn(s));
      return s;
    })
    .finally(() => (statusJob = null));
  return statusJob;
}

// Model indiriliyorsa (notReady) uygulama öne geldiğinde yeniden bak
AppState.addEventListener('change', (st) => {
  if (st === 'active' && status && status !== 'available') refreshStatus(true);
});

// 'available' | 'deviceNotEligible' | 'notEnabled' | 'notReady' | 'unsupported' | null (henüz bilinmiyor)
export function useAiStatus() {
  const [s, setS] = useState(status);
  useEffect(() => {
    listeners.add(setS);
    refreshStatus().then(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}

// ------------------------------------------------------------------ "bir kez" bilgi notu
// Uygun olmayan cihazlarda yalnızca bir kez gösterilen küçük açıklama. Gösterildiği oturum boyunca kalır.
const hintFile = () => new File(Paths.document, 'ai-bilgi.json');
let hintState = null; // 'show' | 'hidden'

export function shouldShowAiHint(s) {
  if (Platform.OS !== 'ios' || !s || s === 'available') return false;
  if (hintState === null) {
    let seen = false;
    try {
      seen = hintFile().exists;
    } catch (e) {}
    hintState = seen ? 'hidden' : 'show';
    if (!seen) {
      try {
        hintFile().write(JSON.stringify({ shown: Date.now() }));
      } catch (e) {}
    }
  }
  return hintState === 'show';
}

export function dismissAiHint() {
  hintState = 'hidden';
}

export function aiHintText(s) {
  if (s === 'notEnabled') return t('ai.hint.notEnabled');
  if (s === 'notReady') return t('ai.hint.notReady');
  if (s === 'deviceNotEligible') return t('ai.hint.device');
  return t('ai.hint.unsupported');
}

// ------------------------------------------------------------------ hata metinleri
export function aiErrorText(e) {
  const code = e && e.code;
  if (code === 'ERR_AI_CONTEXT_WINDOW') return t('ai.err.tooLong');
  if (code === 'ERR_AI_GUARDRAIL') return t('ai.err.guardrail');
  if (code === 'ERR_AI_UNSUPPORTED_LANGUAGE') return t('ai.err.language');
  if (code === 'ERR_AI_NOT_READY' || code === 'ERR_AI_UNAVAILABLE') return t('ai.hint.notReady');
  if (code === 'ERR_AI_BUSY') return t('ai.err.busy');
  if (code === 'ERR_AI_NO_TEXT') return t('ai.err.noText');
  return t('ai.err.generic');
}

// ------------------------------------------------------------------ önbellek
const cache = new Map(); // anahtar → sonuç (yalnızca başarılı sonuçlar)
const running = new Map(); // anahtar → sürmekte olan iş

function hash(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length;
}

export const cacheKey = (feature, id, input) => `${feature}|${lang()}|${id || ''}|${hash(input)}`;
export const cached = (key) => cache.get(key);

async function run(key, instructions, prompt) {
  if (cache.has(key)) return cache.get(key);
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const text = await AI.generate(instructions, prompt);
    cache.set(key, text);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    return text;
  })().finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

// ------------------------------------------------------------------ dil
let langSupport = {};
async function answerLanguage() {
  const l = lang();
  if (langSupport[l] === undefined) langSupport[l] = l === 'en' ? true : await AI.supportsLanguage(l);
  // Model Türkçeyi desteklemiyorsa (ör. eski iOS 26 sürümü) İngilizce yanıt, hata vermekten iyidir
  return langSupport[l] ? l : 'en';
}
const LANG_NAME = { tr: 'Turkish (Türkçe)', en: 'English' };

function baseInstructions(role, l) {
  return (
    `${role} You help a university student who is writing a thesis, homework or article. ` +
    `Style: short, clear, friendly. Start directly with the content. ` +
    `Never thank the user, never greet, never praise the change itself ("great start", "valuable", "interesting"), no filler sentences. ` +
    `Never invent facts that are not in the input and never comment on how often the student saved. ` +
    (l === 'tr'
      ? 'Write natural Turkish and address the student informally with "sen" (e.g. "ekledin", "yazdın"), never "siz". '
      : 'Address the student directly as "you". ') +
    `Always answer in ${LANG_NAME[l]}, even if the input is in another language. Do not use Markdown headings or bold text.`
  );
}

// ------------------------------------------------------------------ 1) belge özeti
// Dönen: { summary: string, points: string[] }
export async function summarizeDocument(id, name, text) {
  const clean = String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length < 40) {
    const e = new Error('no text');
    e.code = 'ERR_AI_NO_TEXT';
    throw e;
  }
  const l = await answerLanguage();
  const instructions = baseInstructions('You summarize documents.', l);
  const { body, excerpt } = sampleText(clean, AI.MAX_PROMPT_CHARS - 600);
  const prompt =
    `Summarize the document "${name}" below.` +
    (excerpt ? ' The document is long, so you only see excerpts from its beginning, middle and end (separated by "[…]").' : '') +
    `\n` +
    `Write exactly this format:\n` +
    `First a summary of 3 to 5 sentences as one paragraph.\n` +
    `Then an empty line, then exactly 3 key points, each on its own line starting with "- ".\n` +
    `Answer in ${LANG_NAME[l]}.\n\n` +
    `DOCUMENT:\n${body}`;
  const out = await run(cacheKey('doc', id, clean), instructions, prompt);
  return parseSummary(out);
}

// Uzun belgelerde yalnızca başı değil; baştan (%55), ortadan (%25) ve sondan (%20) parçalar gönderilir.
export function sampleText(text, budget) {
  if (text.length <= budget) return { body: text, excerpt: false };
  const head = Math.floor(budget * 0.55);
  const mid = Math.floor(budget * 0.25);
  const tail = budget - head - mid;
  const m0 = Math.floor(text.length / 2 - mid / 2);
  return {
    body: `${text.slice(0, head).trimEnd()}\n[…]\n${text.slice(m0, m0 + mid).trim()}\n[…]\n${text.slice(text.length - tail).trimStart()}`,
    excerpt: true,
  };
}

export function parseSummary(out) {
  const lines = String(out || '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const points = [];
  const para = [];
  for (const line of lines) {
    const m = line.match(/^(?:[-•*–]|\d+[.)])\s+(.*)$/);
    if (m) points.push(m[1].replace(/\*\*/g, '').trim());
    else if (/^#+\s|:$/.test(line) && line.length < 40) continue; // "Özet:" / "Key points:" gibi başlıklar
    else para.push(line.replace(/\*\*/g, '').replace(/^(summary|özet)\s*:\s*/i, ''));
  }
  return { summary: para.join(' ').trim(), points: points.slice(0, 5) };
}

// ------------------------------------------------------------------ 2) neler değişti?
// changes: "+ eklenen paragraf" / "- silinen paragraf" / "~ [-eski-]{+yeni+}" satırları
// Diff satırlarını işaretsiz, düz metne ayırır: eklenen / çıkarılan / değişen (eski → yeni)
export function parseChanges(text) {
  const added = [], removed = [], edited = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('+ ')) added.push(line.slice(2).trim());
    else if (line.startsWith('- ')) removed.push(line.slice(2).trim());
    else if (line.startsWith('~ ')) {
      const body = line.slice(2);
      const olds = [...body.matchAll(/\[-([\s\S]*?)-\]/g)].map((m) => m[1].trim()).filter(Boolean);
      const news = [...body.matchAll(/\{\+([\s\S]*?)\+\}/g)].map((m) => m[1].trim()).filter(Boolean);
      edited.push({ old: olds.join(' '), new: news.join(' ') });
    }
  }
  return { added, removed, edited };
}

const wc = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const quote = (s, n = 90) => `“${s.length > n ? s.slice(0, n - 1).trim() + '…' : s}”`;

// Küçük değişiklikleri yapay zekâsız, şablonla ve hatasız anlatır (≤ 20 kelime)
function templateSummary(p) {
  const words = [...p.added, ...p.removed, ...p.edited.map((e) => `${e.old} ${e.new}`)].reduce((a, s) => a + wc(s), 0);
  if (words > 20) return null;
  const parts = [];
  if (p.added.length === 1) parts.push(t('ai.tpl.addedOne', { text: quote(p.added[0]) }));
  else if (p.added.length > 1) parts.push(t('ai.tpl.addedMany', { n: p.added.length }));
  if (p.removed.length === 1) parts.push(t('ai.tpl.removedOne', { text: quote(p.removed[0]) }));
  else if (p.removed.length > 1) parts.push(t('ai.tpl.removedMany', { n: p.removed.length }));
  for (const e of p.edited.slice(0, 2)) {
    if (e.old && e.new) parts.push(t('ai.tpl.replaced', { old: quote(e.old, 50), new: quote(e.new, 50) }));
    else if (e.new) parts.push(t('ai.tpl.addedOne', { text: quote(e.new) }));
    else if (e.old) parts.push(t('ai.tpl.removedOne', { text: quote(e.old) }));
  }
  return parts.length ? parts.join(' ') : null;
}

export async function summarizeChanges(id, name, diff) {
  const text = String((diff && diff.text) || '').trim();
  if (!text) return t('ai.noChanges');
  const p = parseChanges(text);
  const simple = templateSummary(p);
  if (simple) return simple;
  const l = await answerLanguage();
  const instructions = baseInstructions('You explain what changed between two versions of a document.', l);
  // Modele işaret (+, -, ~) değil düz metin verilir; küçük model işaretleri içerik sanabiliyor
  const sections = [];
  if (p.added.length) sections.push(`ADDED TEXT:\n${p.added.map((s) => `• ${s}`).join('\n')}`);
  if (p.removed.length) sections.push(`REMOVED TEXT:\n${p.removed.map((s) => `• ${s}`).join('\n')}`);
  if (p.edited.length) sections.push(`REWORDED:\n${p.edited.map((e) => `• "${e.old}" became "${e.new}"`).join('\n')}`);
  const body = sections.join('\n\n');
  const prompt =
    `The student saved a new version of "${name}".` +
    (diff.first ? ' This is the first version of the file, so everything is new.' : '') +
    `\nIn 1 or 2 short sentences, say what they added, removed or reworded — describe the content itself ` +
    `(e.g. "Giriş bölümüne araştırmanın amacını anlatan bir paragraf ekledin."). No introduction, no evaluation. ` +
    `Answer in ${LANG_NAME[l]}.\n\n${AI.truncate(body, AI.MAX_PROMPT_CHARS - 700)}`;
  return run(cacheKey('diff', id, text), instructions, prompt);
}

// ------------------------------------------------------------------ 3) haftam
// history: kayıtlar (yeniden eskiye); week: computeStats().week; streak: gün
export async function weekRecap(id, history, week, streak) {
  const since = Date.now() - 7 * 86400000;
  const recent = history.filter((h) => h.time >= since && h.kind !== 'merge' && h.kind !== 'mobile');
  const titles = [];
  for (const h of recent) {
    const title = String(h.title || '').trim().slice(0, 90);
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length >= 20) break;
  }
  const perFile = {};
  for (const h of recent) for (const [p, d] of Object.entries(h.delta || {})) perFile[p] = (perFile[p] || 0) + d;
  const files = Object.entries(perFile)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([p, d]) => `${p.split('/').pop()}: ${d > 0 ? '+' : ''}${d} words`);
  const total = week.reduce((a, d) => a + d.words, 0);
  const activeDays = week.filter((d) => d.words > 0).length;
  const data =
    `Words written per day (oldest to today): ${week.map((d) => `${d.label} ${d.words}`).join(', ')}\n` +
    `Total words this week: ${total}. Active writing days: ${activeDays}/7. Current streak: ${streak} days.\n` +
    (files.length ? `Most changed files: ${files.join('; ')}\n` : '') +
    (titles.length ? `Save titles:\n${titles.map((x) => `- ${x}`).join('\n')}` : 'No saves this week.');
  const l = await answerLanguage();
  const instructions = baseInstructions('You are an encouraging writing coach.', l);
  const prompt =
    `Here is the student's writing activity for the last 7 days.\n${data}\n\n` +
    `Write a recap in at most 3 short sentences: first what they concretely worked on (from the save titles and files), ` +
    `then the numbers (words, active days, streak), then one short, kind nudge for the coming days. ` +
    `If there was little activity, be gentle, never guilt-tripping. At most one emoji. Answer in ${LANG_NAME[l]}.`;
  return run(cacheKey('week', id, data), instructions, AI.truncate(prompt, AI.MAX_PROMPT_CHARS));
}
