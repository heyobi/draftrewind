// Kayıt noktası başlıkları: değişikliği yerelde analiz edip okunur bir özet çıkarır.
// Hiçbir veri dış servise gönderilmez; kurallar belgenin yapısına (başlıklar, paragraflar,
// kaynakça girdileri, tablo hücreleri) bakar.
const path = require('path');
const Diff = require('diff');
const docs = require('./docs');
const I18N = require('../i18n/strings');
const T = (key, vars) => I18N.text(key, vars);

const stem = rel => path.basename(rel, path.extname(rel));
const short = (s, n = 32) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
// "2.1 Veri Seti" → "Veri Seti"
const cleanHeading = h => short(h.replace(/^(\d+(\.\d+)*\.?|[IVX]+\.|BÖLÜM\s+\d+[:.]?|Bölüm\s+\d+[:.]?)\s*/, '') || h);

async function describeWord(oldBuf, newBuf) {
    const [a, b] = await Promise.all([docs.wordStructure(oldBuf), docs.wordStructure(newBuf)]);
    if (!a || !b) return null;
    const oldHeads = new Set(a.filter(p => p.heading).map(p => p.text));
    const newHeads = new Set(b.filter(p => p.heading).map(p => p.text));
    const addedHeads = [...newHeads].filter(h => !oldHeads.has(h));
    const removedHeads = [...oldHeads].filter(h => !newHeads.has(h));

    const chunks = Diff.diffArrays(a.map(p => p.text), b.map(p => p.text));
    let added = 0, removed = 0, modified = 0, changedWords = 0;
    const touched = new Set();
    let posNew = 0;
    const sectionAt = idx => {
        for (let i = Math.min(idx, b.length - 1); i >= 0; i--) if (b[i].heading) return b[i].text;
        return null;
    };
    for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const next = chunks[i + 1];
        if (c.removed && next && next.added) {
            const pairs = Math.min(c.value.length, next.value.length);
            modified += pairs;
            added += next.value.length - pairs;
            removed += c.value.length - pairs;
            for (let j = 0; j < pairs; j++) {
                for (const part of Diff.diffWords(c.value[j], next.value[j])) {
                    if (part.added || part.removed) changedWords += docs.countWordsInLines([part.value]);
                }
            }
            for (let j = 0; j < next.value.length; j++) touched.add(sectionAt(posNew + j));
            posNew += next.value.length;
            i++;
        } else if (c.added) {
            added += c.value.length;
            changedWords += docs.countWordsInLines(c.value);
            for (let j = 0; j < c.value.length; j++) touched.add(sectionAt(posNew + j));
            posNew += c.value.length;
        } else if (c.removed) {
            removed += c.value.length;
            changedWords += docs.countWordsInLines(c.value);
            touched.add(sectionAt(Math.max(0, posNew - 1)));
        } else {
            posNew += c.value.length;
        }
    }
    touched.delete(null);
    for (const h of addedHeads) touched.delete(h);

    if (!added && !removed && !modified) return { phrase: T('desc.format'), weight: 1 };
    if (addedHeads.length === 1) return { phrase: T('desc.sectionAdded', { h: cleanHeading(addedHeads[0]) }), weight: 50 };
    if (addedHeads.length > 1) return { phrase: T('desc.sectionsAdded', { n: addedHeads.length }), weight: 60 };
    if (removedHeads.length === 1 && removed > 1) return { phrase: T('desc.sectionRemoved', { h: cleanHeading(removedHeads[0]) }), weight: 40 };

    const sections = [...touched];
    const where = sections.length === 1 ? T('desc.whereOne', { h: cleanHeading(sections[0]) }) : sections.length > 1 ? T('desc.whereMany', { n: sections.length }) : '';
    // "… bölümüne N paragraf eklendi" / "N paragraphs added to …"
    const whereTo = sections.length === 1 ? T('desc.whereOneTo', { h: cleanHeading(sections[0]) }) : where;
    if (!added && !removed && changedWords <= 8) return { phrase: T('desc.minor', { where }), weight: 5 };
    if (added && !removed && modified <= 1) return { phrase: T('desc.parasAdded', { where: whereTo, n: added }), weight: 20 + added };
    if (removed && !added && modified <= 1) return { phrase: T('desc.parasRemoved', { where, n: removed }), weight: 15 + removed };
    if (modified >= 5 && modified >= added + removed) return { phrase: T('desc.reworked', { where, n: modified }), weight: 25 };
    const parts = [];
    if (added) parts.push(T('desc.partAdded', { n: added }));
    if (removed) parts.push(T('desc.partRemoved', { n: removed }));
    if (modified) parts.push(T('desc.partEdited', { n: modified }));
    return { phrase: T('desc.mixed', { where, parts: parts.join(', ') }), weight: 10 + added + removed + modified };
}

function bibKeys(buf) {
    const keys = new Set();
    for (const m of Buffer.from(buf).toString('utf8').matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) keys.add(m[1]);
    return keys;
}

function describeBib(oldBuf, newBuf) {
    const a = bibKeys(oldBuf), b = bibKeys(newBuf);
    const add = [...b].filter(k => !a.has(k)).length;
    const rem = [...a].filter(k => !b.has(k)).length;
    if (add && !rem) return { phrase: T('desc.bibAdded', { n: add }), weight: 20 + add };
    if (rem && !add) return { phrase: T('desc.bibRemoved', { n: rem }), weight: 15 };
    if (add || rem) return { phrase: T('desc.bibBoth', { a: add, r: rem }), weight: 20 };
    return { phrase: T('desc.bibFixed'), weight: 5 };
}

async function describeLines(rel, oldBuf, newBuf, unit) {
    const [a, b] = await Promise.all([docs.extractLines(rel, oldBuf), docs.extractLines(rel, newBuf)]);
    if (!a || !b) return null;
    let add = 0, rem = 0;
    for (const c of Diff.diffArrays(a, b)) {
        if (c.added) add += c.value.length;
        else if (c.removed) rem += c.value.length;
    }
    if (unit === 'hücre') {
        // Değişen hücre sayısı (aynı hücrenin eski ve yeni hali bir sayılır)
        const refs = new Set();
        for (const c of Diff.diffArrays(a, b)) if (c.added || c.removed) for (const l of c.value) refs.add(l.split(':')[0]);
        return refs.size ? { phrase: T('desc.cells', { n: refs.size }), weight: 10 + Math.min(refs.size, 30) } : { phrase: T('desc.formatOnly'), weight: 1 };
    }
    if (unit === 'slayt') {
        const slides = new Set();
        for (const c of Diff.diffArrays(a, b)) if (c.added || c.removed) for (const l of c.value) slides.add(l.split(' · ')[0]);
        return slides.size ? { phrase: T('desc.slides', { n: slides.size }), weight: 10 + slides.size } : { phrase: T('desc.design'), weight: 1 };
    }
    if (add && !rem) return { phrase: T('desc.linesAdded', { n: add }), weight: 10 + add };
    if (rem && !add) return { phrase: T('desc.linesDeleted', { n: rem }), weight: 8 + rem };
    return { phrase: T('desc.linesChanged', { n: add + rem }), weight: 8 + add };
}

async function describeFile(rel, oldBuf, newBuf) {
    const name = path.basename(rel);
    if (!oldBuf && newBuf) return { rel, phrase: T('desc.newFile'), title: T('desc.newFileTitle', { name }), weight: 30 };
    if (oldBuf && !newBuf) return { rel, phrase: T('desc.deleted'), title: T('snap.deleted', { name }), weight: 25 };
    const kind = docs.kindOf(rel);
    const ext = path.extname(rel).toLowerCase();
    let d = null;
    try {
        if (kind === 'word') d = await describeWord(oldBuf, newBuf);
        else if (ext === '.bib') d = describeBib(oldBuf, newBuf);
        else if (kind === 'sheet') d = await describeLines(rel, oldBuf, newBuf, 'hücre');
        else if (kind === 'slides') d = await describeLines(rel, oldBuf, newBuf, 'slayt');
        else if (kind === 'text') d = await describeLines(rel, oldBuf, newBuf, 'satır');
    } catch (e) {}
    if (!d) d = { phrase: T('desc.updated'), weight: 5 };
    // Kaynakça için dosya adı tekrarına gerek yok
    return { rel, ...d, title: ext === '.bib' ? d.phrase : `${stem(rel)}: ${d.phrase}` };
}

const wordNote = n => (n ? T('snap.words', { n: n > 0 ? `+${n}` : `${n}`, count: n }) : '');

// files: [{ rel, oldBuf, newBuf }], delta: { rel: kelime farkı } → { title, body }
async function describeSnapshot(files, delta) {
    const descs = [];
    for (const f of files.slice(0, 12)) descs.push(await describeFile(f.rel, f.oldBuf, f.newBuf));
    if (!descs.length) return null;
    descs.sort((x, y) => y.weight - x.weight);
    const totalWords = Object.values(delta || {}).reduce((a, b) => a + b, 0);
    const main = descs[0];
    const extra = files.length - 1;
    let title = main.title;
    title = title.charAt(0).toLocaleUpperCase(I18N.locale()) + title.slice(1);
    if (extra > 0) title += T('common.andMore', { n: extra });
    title += wordNote(totalWords);
    const body = files.length > 1 ? descs.map(d => `• ${stem(d.rel)} — ${d.phrase}${wordNote((delta || {})[d.rel] || 0)}`).join('\n') : '';
    return { title, body };
}

// Yapay zekâya verilecek kısa değişiklik metni: dosya, bölüm, eklenen (+) / çıkan (-) satırlar.
// Zayıf bilgisayarlarda hızlı kalsın diye ~1800 karakterle sınırlıdır.
async function changeDigest(files, limit = 1800) {
    let out = '';
    for (const f of files.slice(0, 3)) {
        const kind = docs.kindOf(f.rel);
        if (!f.newBuf) {
            out += `File deleted: ${f.rel}\n`;
            continue;
        }
        if (!f.oldBuf) {
            out += `New file: ${f.rel}\n`;
            continue;
        }
        if (kind !== 'word' && kind !== 'text' && kind !== 'sheet' && kind !== 'slides') {
            out += `Changed: ${f.rel}\n`;
            continue;
        }
        const [a, b] = await Promise.all([docs.extractLines(f.rel, f.oldBuf), docs.extractLines(f.rel, f.newBuf)]);
        if (!a || !b) continue;
        let section = null;
        if (kind === 'word') {
            const st = await docs.wordStructure(f.newBuf);
            section = st ? st : null;
        }
        out += `File: ${f.rel}\n`;
        let pos = 0;
        const headingBefore = idx => {
            if (!section) return null;
            for (let i = Math.min(idx, section.length - 1); i >= 0; i--) if (section[i].heading) return section[i].text;
            return null;
        };
        let lastHeading = null;
        for (const c of Diff.diffArrays(a, b)) {
            if (!c.added && !c.removed) {
                pos += c.value.length;
                continue;
            }
            const h = headingBefore(pos);
            if (h && h !== lastHeading) {
                out += `Section: ${h}\n`;
                lastHeading = h;
            }
            for (const line of c.value) out += `${c.added ? '+' : '-'} ${line.slice(0, 300)}\n`;
            if (c.added) pos += c.value.length;
            if (out.length > limit) break;
        }
        if (out.length > limit) break;
    }
    return out.slice(0, limit);
}

module.exports = { describeSnapshot, describeFile, changeDigest, wordNote };
