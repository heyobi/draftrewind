// Zayıf yerel model için "olgu kartı": uzun değişikliği modele ham vermek yerine kodla özetleriz.
// Sayılar + dokunulan bölümler + birkaç paragrafın ilk cümlesi → en fazla ~900 karakter.
// Model bu kartı 1-2 cümleye çevirir; çıktı vet() ile denetlenir, geçmezse şablon gösterilir.
const { grounded } = require('./ai');

const wc = s => (String(s).match(/[\p{L}\p{N}]+/gu) || []).length;
const cut = (s, n) => {
    const x = String(s || '').replace(/\s+/g, ' ').trim();
    return x.length > n ? x.slice(0, n - 1).trim() + '…' : x;
};
const firstSentence = (s, n = 140) => {
    const x = String(s || '').replace(/\s+/g, ' ').trim();
    const m = x.match(/^.{12,}?[.!?…](?=\s|$)/);
    return cut(m ? m[0] : x, n);
};
const CODE_RE = /\.(py|js|ts|jsx|tsx|java|c|cc|cpp|h|cs|r|m|go|rb|php|swift|kt|sql|sh|ps1|json|ya?ml|xml|html|css|ipynb|tex|bib)$/i;
const isCode = rel => CODE_RE.test(String(rel || ''));

function looksHeading(s) {
    const x = String(s || '').trim();
    if (!x || x.length > 90 || /[.:;,]$/.test(x)) return false;
    const words = x.split(/\s+/).length;
    if (words > 12) return false;
    if (/^(\d+(\.\d+)*\.?|[IVX]+\.|BÖLÜM|Bölüm|EK|Ek|CHAPTER|Chapter)\s+\S/.test(x)) return true;
    return words <= 6 && x === x.toLocaleUpperCase('tr-TR') && /\p{L}/u.test(x);
}

// added/removed: paragraf dizileri; edited: [{old,new}]; sections: dokunulan bölüm başlıkları
function changeFacts({ added = [], removed = [], edited = [], sections = [] }) {
    const addWords = added.reduce((a, s) => a + wc(s), 0) + edited.reduce((a, e) => a + wc(e.new), 0);
    const remWords = removed.reduce((a, s) => a + wc(s), 0) + edited.reduce((a, e) => a + wc(e.old), 0);
    return {
        nAdded: added.length,
        nRemoved: removed.length,
        nEdited: edited.length,
        addWords,
        remWords,
        sections: [...new Set(sections)].slice(0, 4).map(h => cut(h, 60)),
        newHeads: added.filter(looksHeading).slice(0, 4).map(h => cut(h, 60)),
        addedSamples: added.filter(s => !looksHeading(s) && wc(s) >= 4).slice(0, 3).map(s => firstSentence(s)),
        removedSamples: removed.filter(s => !looksHeading(s) && wc(s) >= 4).slice(0, 2).map(s => firstSentence(s)),
        edits: edited.filter(e => e.old && e.new).slice(0, 2).map(e => ({ old: cut(e.old, 70), new: cut(e.new, 70) })),
        small: addWords + remWords <= 20
    };
}

// grounded() yalnızca "+", "-" ve "Section:" satırlarını kaynak sayar; kart bu biçimde yazılır
function factsText(f, rel) {
    const lines = [];
    if (rel) lines.push(`File: ${rel}`);
    lines.push(`Paragraphs added: ${f.nAdded} (~${f.addWords} words). Removed: ${f.nRemoved} (~${f.remWords} words). Reworded: ${f.nEdited}.`);
    for (const s of f.sections) lines.push(`Section: ${s}`);
    for (const h of f.newHeads) lines.push(`Section: ${h} (new)`);
    for (const s of f.addedSamples) lines.push(`+ ${s}`);
    for (const s of f.removedSamples) lines.push(`- ${s}`);
    for (const e of f.edits) lines.push(`- ${e.old}`, `+ ${e.new}`);
    return lines.join('\n').slice(0, 900);
}

// Her zaman doğru olan şablon cümle. T: i18n çevirici
function templateChange(f, T, { added = [], removed = [], edited = [] } = {}) {
    const q = (s, n = 80) => `“${cut(s, n)}”`;
    const parts = [];
    if (f.small) {
        if (added.length === 1) parts.push(T('ai.tpl.addedOne', { text: q(added[0]) }));
        else if (added.length > 1) parts.push(T('ai.tpl.addedMany', { n: added.length }));
        if (removed.length === 1) parts.push(T('ai.tpl.removedOne', { text: q(removed[0]) }));
        else if (removed.length > 1) parts.push(T('ai.tpl.removedMany', { n: removed.length }));
        for (const e of edited.slice(0, 2)) {
            if (e.old && e.new) parts.push(T('ai.tpl.replaced', { old: q(e.old, 50), new: q(e.new, 50) }));
            else if (e.new) parts.push(T('ai.tpl.addedOne', { text: q(e.new) }));
            else if (e.old) parts.push(T('ai.tpl.removedOne', { text: q(e.old) }));
        }
        if (parts.length) return parts.join(' ');
    }
    if (f.newHeads.length) parts.push(T('ai.tpl.newSections', { list: f.newHeads.map(h => q(h, 40)).join(', ') }));
    else if (f.sections.length) parts.push(T('ai.tpl.inSections', { list: f.sections.map(h => q(h, 40)).join(', ') }));
    if (f.nAdded) parts.push(T('ai.tpl.addedMany', { n: f.nAdded }));
    if (f.nRemoved) parts.push(T('ai.tpl.removedMany', { n: f.nRemoved }));
    if (f.nEdited) parts.push(T('ai.tpl.editedMany', { n: f.nEdited }));
    parts.push(T('ai.tpl.wordsDelta', { add: f.addWords, rem: f.remWords }));
    return parts.join(' ');
}

// Modelin cevabını temizle ve denetle; geçmezse null
function vet(out, source, max = 320) {
    const x = String(out || '')
        .replace(/\*\*/g, '')
        .replace(/[\p{Extended_Pictographic}️‍]/gu, '')
        .replace(/ {2,}/g, ' ')
        .replace(/^["“”']+|["“”']+$/g, '')
        .trim();
    if (x.length < 8 || x.length > max) return null;
    if (/\[-|\{\+|^[+~-]\s|^Section:|^File:|Paragraphs added|Reworded:/m.test(x)) return null;
    if (source && !grounded(x, source)) return null;
    return x;
}

module.exports = { wc, cut, firstSentence, looksHeading, isCode, changeFacts, factsText, templateChange, vet };
