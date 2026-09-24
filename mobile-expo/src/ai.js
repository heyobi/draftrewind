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
      ? 'Write natural Turkish and address the student informally with the "sen" form (second person singular verbs), never "siz". '
      : 'Address the student directly as "you". ') +
    `Always answer in ${LANG_NAME[l]}, even if the input is in another language. Do not use Markdown headings or bold text. Never use emojis.`
  );
}

// ==================================================================
// Strateji: cihaz üstü model küçük ve zayıf. Uzun metni ASLA ham haliyle vermeyiz.
//  1) Olguları kodla çıkar (hangi bölüm, kaç paragraf/kelime, ilk cümleler) → en fazla ~900 karakter.
//  2) Mümkünse modeli hiç çalıştırma: küçük değişiklik, yeni dosya ve kod dosyası şablonla anlatılır.
//  3) Model sadece olgu kartını 1-2 doğal cümleye çevirir; çıktı denetlenir, şüpheliyse şablon gösterilir.
// ==================================================================

const wc = (s) => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const cut = (s, n) => {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  return x.length > n ? x.slice(0, n - 1).trim() + '…' : x;
};
const quote = (s, n = 90) => `“${cut(s, n)}”`;
// Bir paragrafın ilk cümlesi (uzun paragrafları özetlemek için modelden önce kodla kısaltırız)
const firstSentence = (s, n = 140) => {
  const x = String(s || '').replace(/\s+/g, ' ').trim();
  const m = x.match(/^.{12,}?[.!?…](?=\s|$)/);
  return cut(m ? m[0] : x, n);
};
const CODE_RE = /\.(py|js|ts|jsx|tsx|java|c|cc|cpp|h|cs|r|m|go|rb|php|swift|kt|sql|sh|ps1|json|ya?ml|xml|html|css|ipynb|tex|bib)$/i;
export const isCodeName = (name) => CODE_RE.test(String(name || ''));

// "1. Giriş", "2.3 Veri Seti", "BÖLÜM 2", kısa ve noktasız satırlar
export function looksHeading(s) {
  const x = String(s || '').trim();
  if (!x || x.length > 90 || /[.:;,]$/.test(x)) return false;
  const words = x.split(/\s+/).length;
  if (words > 12) return false;
  if (/^(\d+(\.\d+)*\.?|[IVX]+\.|BÖLÜM|Bölüm|EK|Ek|CHAPTER|Chapter)\s+\S/.test(x)) return true;
  return words <= 6 && x === x.toLocaleUpperCase('tr-TR') && /\p{L}/u.test(x);
}

// Uydurma kontrolü: çıktıda kaynaktaki anlamlı bir kelime kökü (5 harf) geçmeli; genel kelimeler sayılmaz
const GENERIC = ['bolum', 'ekle', 'eklen', 'cikar', 'silin', 'paragr', 'dosya', 'guncel', 'duzel', 'degis', 'yeni', 'metin', 'belge', 'yapil', 'icin', 'olara', 'kelim', 'cumle', 'ifade', 'ogrenc', 'chapt', 'secti', 'added', 'remov', 'delet', 'updat', 'chang', 'parag', 'file', 'docum', 'text', 'with', 'from', 'into', 'about', 'words', 'sente', 'stude', 'this', 'that', 'bunla', 'olan', 'ayrica', 'sonra'];
const norm = (s) => String(s).toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
export function grounded(out, source) {
  const src = norm(source);
  const stems = norm(out)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 5))
    .filter((s) => !GENERIC.some((g) => s.startsWith(g) || g.startsWith(s)));
  return stems.some((s) => src.includes(s));
}

// Emoji ayıklayıcı: model ne yazarsa yazsın arayüzde emoji görünmesin.
// Unicode özellik kaçışı desteklenmiyorsa (eski motor) başlıca emoji aralıklarına düşer.
const EMOJI_RE = (() => {
  try {
    return new RegExp('[\\p{Extended_Pictographic}\\u{1F1E6}-\\u{1F1FF}\\u{1F3FB}-\\u{1F3FF}\\uFE0F\\uFE0E\\u200D\\u20E3]', 'gu');
  } catch (e) {
    return /[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\uFE0E\u200D\u20E3]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]/g;
  }
})();
export function stripEmoji(text) {
  return String(text || '')
    .replace(EMOJI_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/^[ \t]+|[ \t]+$/gm, '');
}

// Modelin cevabını temizle ve denetle; geçmezse null (→ şablon)
function vet(out, source, max = 320) {
  let x = stripEmoji(out).replace(/\*\*/g, '').replace(/^["“”']+|["“”']+$/g, '').replace(/\s+\n/g, '\n').trim();
  if (x.length < 8 || x.length > max) return null;
  // İşaret/etiket kopyası ya da istemin kendisi → at
  if (/\[-|\{\+|^[+~-]\s|ADDED|REMOVED|REWORDED|Paragraphs added|FACTS|OLGU/m.test(x)) return null;
  if (source && !grounded(x, source)) return null;
  return x;
}

// ------------------------------------------------------------------ 1) belge özeti
// Tüm metin değil, kodla çıkarılan ana hat gönderilir: başlıklar + her bölümün ilk cümlesi
// (başlık yoksa belgeye eşit aralıklı paragrafların ilk cümleleri). Belge 300 sayfa da olsa girdi küçük kalır.
export function outline(text, budget = 1600) {
  const paras = String(text || '')
    .split(/\n+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length > 1);
  const items = [];
  const heads = [];
  for (let i = 0; i < paras.length; i++) {
    if (looksHeading(paras[i])) {
      const next = paras.slice(i + 1).find((p) => !looksHeading(p) && wc(p) >= 5);
      heads.push(paras[i]);
      items.push(next ? `${cut(paras[i], 70)}: ${firstSentence(next, 150)}` : cut(paras[i], 70));
    }
  }
  if (items.length < 2) {
    // Başlık yok: 10 eşit aralıklı paragrafın ilk cümlesi
    const body = paras.filter((p) => wc(p) >= 6);
    const step = Math.max(1, Math.floor(body.length / 10));
    items.length = 0;
    for (let i = 0; i < body.length && items.length < 10; i += step) items.push(firstSentence(body[i], 150));
  }
  // Sığmıyorsa baştan kesmek yerine belgenin tamamına eşit dağıt (tezin son bölümleri de görünsün)
  const avg = items.reduce((a, x) => a + x.length + 3, 0) / Math.max(1, items.length);
  const fit = Math.max(1, Math.floor(budget / avg));
  let pick = items;
  if (items.length > fit) {
    pick = [];
    for (let k = 0; k < fit; k++) pick.push(items[Math.round((k * (items.length - 1)) / Math.max(1, fit - 1))]);
    pick = [...new Set(pick)];
  }
  let out = '';
  for (const it of pick) {
    if (out.length + it.length + 3 > budget) break;
    out += `• ${it}\n`;
  }
  return { text: out.trim(), heads, words: wc(text) };
}

// Dönen: { summary: string, points: string[] }
export async function summarizeDocument(id, name, text) {
  const clean = String(text || '').trim();
  if (clean.length < 40) {
    const e = new Error('no text');
    e.code = 'ERR_AI_NO_TEXT';
    throw e;
  }
  const o = outline(clean);
  const fallback = () => ({
    summary: t('ai.tpl.docFallback', { words: o.words.toLocaleString(), name }),
    points: (o.heads.length ? o.heads : o.text.split('\n').map((x) => x.replace(/^•\s*/, ''))).slice(0, 3).map((x) => cut(x, 90)),
  });
  if (!o.text || isCodeName(name)) return fallback();
  const l = await answerLanguage();
  const instructions = baseInstructions('You summarize documents from an outline.', l);
  const prompt =
    `Below is an outline of the document "${name}" (about ${o.words} words): its section headings and the first sentence of each part.\n` +
    `Using ONLY this outline, write a summary of 2 to 3 sentences as one paragraph, then an empty line, ` +
    `then exactly 3 key points, each on its own line starting with "- ". Answer in ${LANG_NAME[l]}.\n\n` +
    `OUTLINE:\n${o.text}`;
  try {
    const out = await run(cacheKey('doc', id, o.text), instructions, prompt);
    const parsed = parseSummary(out);
    const summary = vet(parsed.summary, o.text, 600);
    if (!summary) return fallback();
    const points = parsed.points.map((p) => vet(p, o.text, 200)).filter(Boolean);
    return { summary, points: points.length ? points : fallback().points };
  } catch (e) {
    if (e && e.code === 'ERR_AI_CONTEXT_WINDOW') return fallback();
    throw e;
  }
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
    else para.push(line.replace(/\*\*/g, '').replace(/^(summary|özet)\s*:\s*/i, ''));
  }
  return { summary: para.join(' ').trim(), points: points.slice(0, 5) };
}

// ------------------------------------------------------------------ 2) neler değişti?
// Diff metni: "+ eklenen paragraf" / "- silinen paragraf" / "~ [-eski-]{+yeni+}" satırları → düz listeler
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

// Değişikliğin olgu kartı: model bunu görür, ham metni değil
export function changeFacts(p) {
  const addWords = p.added.reduce((a, s) => a + wc(s), 0) + p.edited.reduce((a, e) => a + wc(e.new), 0);
  const remWords = p.removed.reduce((a, s) => a + wc(s), 0) + p.edited.reduce((a, e) => a + wc(e.old), 0);
  const newHeads = p.added.filter(looksHeading).slice(0, 4).map((h) => cut(h, 60));
  const goneHeads = p.removed.filter(looksHeading).slice(0, 3).map((h) => cut(h, 60));
  const addedSamples = p.added.filter((s) => !looksHeading(s) && wc(s) >= 4).slice(0, 3).map((s) => firstSentence(s));
  const removedSamples = p.removed.filter((s) => !looksHeading(s) && wc(s) >= 4).slice(0, 2).map((s) => firstSentence(s));
  const edits = p.edited.filter((e) => e.old || e.new).slice(0, 2).map((e) => ({ old: cut(e.old, 70), new: cut(e.new, 70) }));
  return { addWords, remWords, newHeads, goneHeads, addedSamples, removedSamples, edits, nAdded: p.added.length, nRemoved: p.removed.length, nEdited: p.edited.length };
}

function factsText(f) {
  const lines = [`Paragraphs added: ${f.nAdded} (~${f.addWords} words). Removed: ${f.nRemoved} (~${f.remWords} words). Reworded: ${f.nEdited}.`];
  if (f.newHeads.length) lines.push(`New section headings: ${f.newHeads.join(' | ')}`);
  if (f.goneHeads.length) lines.push(`Removed section headings: ${f.goneHeads.join(' | ')}`);
  if (f.addedSamples.length) lines.push(`Added text begins:\n${f.addedSamples.map((s) => `• ${s}`).join('\n')}`);
  if (f.removedSamples.length) lines.push(`Removed text begins:\n${f.removedSamples.map((s) => `• ${s}`).join('\n')}`);
  if (f.edits.length) lines.push(`Reworded:\n${f.edits.map((e) => `• "${e.old}" → "${e.new}"`).join('\n')}`);
  return lines.join('\n');
}

// Şablon: her zaman doğru. Küçük değişikliklerde ayrıntılı, büyüklerde sayısal.
function templateChange(p, f) {
  const small = f.addWords + f.remWords <= 20;
  const parts = [];
  if (small) {
    if (p.added.length === 1) parts.push(t('ai.tpl.addedOne', { text: quote(p.added[0]) }));
    else if (p.added.length > 1) parts.push(t('ai.tpl.addedMany', { n: p.added.length }));
    if (p.removed.length === 1) parts.push(t('ai.tpl.removedOne', { text: quote(p.removed[0]) }));
    else if (p.removed.length > 1) parts.push(t('ai.tpl.removedMany', { n: p.removed.length }));
    for (const e of p.edited.slice(0, 2)) {
      if (e.old && e.new) parts.push(t('ai.tpl.replaced', { old: quote(e.old, 50), new: quote(e.new, 50) }));
      else if (e.new) parts.push(t('ai.tpl.addedOne', { text: quote(e.new) }));
      else if (e.old) parts.push(t('ai.tpl.removedOne', { text: quote(e.old) }));
    }
    return parts.join(' ') || null;
  }
  if (f.newHeads.length) parts.push(t('ai.tpl.newSections', { list: f.newHeads.map((h) => quote(h, 40)).join(', ') }));
  if (f.nAdded) parts.push(t('ai.tpl.addedMany', { n: f.nAdded }));
  if (f.nRemoved) parts.push(t('ai.tpl.removedMany', { n: f.nRemoved }));
  if (f.nEdited) parts.push(t('ai.tpl.editedMany', { n: f.nEdited }));
  parts.push(t('ai.tpl.wordsDelta', { add: f.addWords, rem: f.remWords }));
  return parts.join(' ');
}

export async function summarizeChanges(id, name, diff) {
  const text = String((diff && diff.text) || '').trim();
  if (!text) return t('ai.noChanges');
  const p = parseChanges(text);
  const f = changeFacts(p);
  const lines = p.added.length + p.removed.length;
  // Yeni dosya: içerik modelle "özetlenmez"; sadece boyut ve (belgeyse) başlangıcı söylenir
  if (diff.first) {
    const first = p.added.find((s) => wc(s) >= 3);
    const base = t('ai.tpl.newFile', { name, words: f.addWords.toLocaleString() });
    if (isCodeName(name)) return `${base} ${t('ai.tpl.codeLines', { n: lines })}`;
    const heads = p.added.filter(looksHeading).slice(0, 3);
    if (heads.length) return `${base} ${t('ai.tpl.sections', { list: heads.map((h) => quote(h, 40)).join(', ') })}`;
    return first ? `${base} ${t('ai.tpl.startsWith', { text: quote(firstSentence(first, 90), 90) })}` : base;
  }
  // Kod dosyası: sadece sayılar
  if (isCodeName(name)) return t('ai.tpl.codeChanged', { add: p.added.length, rem: p.removed.length, ed: p.edited.length });
  const template = templateChange(p, f);
  // Küçük değişiklik ya da örnek cümle yok → model gerekmez
  if (f.addWords + f.remWords <= 20 || (!f.addedSamples.length && !f.removedSamples.length && !f.edits.length)) return template;
  const l = await answerLanguage();
  const facts = factsText(f);
  const instructions = baseInstructions('You turn a fact sheet about a document edit into one or two plain sentences.', l);
  const prompt =
    `The student saved a new version of "${name}". Below are FACTS about the change (computed by the app).\n` +
    `In 1 or 2 short sentences, tell the student what changed and what the added or removed text is about. ` +
    `Use ONLY these facts; do not repeat the labels. Answer in ${LANG_NAME[l]}.\n\n${facts}`;
  try {
    const out = await run(cacheKey('diff', id, facts), instructions, prompt);
    return vet(out, facts) || template;
  } catch (e) {
    if (e && (e.code === 'ERR_AI_CONTEXT_WINDOW' || e.code === 'ERR_AI_GUARDRAIL')) return template;
    throw e;
  }
}

// ------------------------------------------------------------------ 3) haftam
// history: kayıtlar (yeniden eskiye); week: computeStats().week; streak: gün
export async function weekRecap(id, history, week, streak) {
  const since = Date.now() - 7 * 86400000;
  const recent = history.filter((h) => h.time >= since && h.kind !== 'merge' && h.kind !== 'mobile');
  const titles = [];
  for (const h of recent) {
    const title = cut(h.title, 80);
    if (title && !titles.includes(title)) titles.push(title);
    if (titles.length >= 8) break;
  }
  const perFile = {};
  for (const h of recent) for (const [p, d] of Object.entries(h.delta || {})) perFile[p] = (perFile[p] || 0) + d;
  const files = Object.entries(perFile)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([p, d]) => `${p.split('/').pop()}: ${d > 0 ? '+' : ''}${d} words`);
  const total = week.reduce((a, d) => a + d.words, 0);
  const activeDays = week.filter((d) => d.words > 0).length;
  const template = t('ai.tpl.week', { words: total.toLocaleString(), days: activeDays, streak });
  if (!recent.length) return template;
  const data =
    `Total words this week: ${total}. Active writing days: ${activeDays}/7. Current streak: ${streak} days.\n` +
    (files.length ? `Most changed files: ${files.join('; ')}\n` : '') +
    `Save titles:\n${titles.map((x) => `- ${x}`).join('\n')}`;
  const l = await answerLanguage();
  const instructions = baseInstructions('You are a concise writing coach.', l);
  const prompt =
    `FACTS about the student's last 7 days:\n${data}\n\n` +
    `In at most 3 short sentences: what they worked on (from the titles/files), the numbers, then one short, kind nudge. ` +
    `Use ONLY these facts. If there was little activity, be gentle. Do not use emojis. Answer in ${LANG_NAME[l]}.`;
  try {
    const out = await run(cacheKey('week', id, data), instructions, prompt);
    return vet(out, null, 420) || template;
  } catch (e) {
    return template;
  }
}
