const JSZip = require('jszip');
const path = require('path');

const TEXT_EXT = new Set(['.txt', '.md', '.tex', '.bib', '.csv', '.rmd', '.qmd', '.r', '.py', '.m', '.json', '.yaml', '.yml']);
const WORD_EXT = new Set(['.docx', '.docm', '.dotx']);
const SHEET_EXT = new Set(['.xlsx', '.xlsm']);
const PRESENT_EXT = new Set(['.pptx']);

function kindOf(rel) {
    const ext = path.extname(rel).toLowerCase();
    if (WORD_EXT.has(ext)) return 'word';
    if (SHEET_EXT.has(ext)) return 'sheet';
    if (PRESENT_EXT.has(ext)) return 'slides';
    if (ext === '.pdf') return 'pdf';
    if (TEXT_EXT.has(ext)) return 'text';
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.tif', '.tiff'].includes(ext)) return 'image';
    return 'other';
}

// Kelime sayılan belge türleri
function countsWords(rel) {
    const k = kindOf(rel);
    const ext = path.extname(rel).toLowerCase();
    return k === 'word' || k === 'slides' || ['.txt', '.md', '.tex', '.rmd', '.qmd'].includes(ext);
}

function decodeXml(s) {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&amp;/g, '&');
}

function paragraphsFromWordXml(xml) {
    return wordParagraphs(xml).map(p => p.text);
}

// Paragraflar + başlık mı? (Heading/Başlık/Title stili veya anahat düzeyi)
function wordParagraphs(xml) {
    const out = [];
    const paras = xml.split(/<\/w:p>/);
    for (const p of paras) {
        const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
        const heading = /heading|başlık|baslik|title|konu/i.test(style) || /<w:outlineLvl w:val="[0-8]"/.test(p);
        let text = '';
        const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
        let m;
        while ((m = re.exec(p))) {
            if (m[1] !== undefined) text += decodeXml(m[1]);
            else text += m[0].startsWith('<w:tab') ? '\t' : ' ';
        }
        text = text.trim();
        if (text) out.push({ text, heading: heading || looksLikeHeading(text) });
    }
    return out;
}

// Stil kullanılmadan elle yazılmış başlıklar: "1. Giriş", "2.3 Veri Seti", "BÖLÜM 2", "SONUÇ"
function looksLikeHeading(text) {
    if (text.length > 90 || /[.:;,]$/.test(text)) return false;
    const words = text.split(/\s+/).length;
    if (words > 12) return false;
    if (/^(\d+(\.\d+)*\.?|[IVX]+\.|BÖLÜM|Bölüm|EK|Ek)\s+\S/.test(text)) return true;
    return words <= 6 && text === text.toLocaleUpperCase('tr-TR') && /\p{L}/u.test(text);
}

async function wordStructure(buffer) {
    try {
        const zip = await JSZip.loadAsync(buffer);
        const doc = zip.file('word/document.xml');
        return doc ? wordParagraphs(await doc.async('string')) : [];
    } catch (e) {
        return null;
    }
}

async function sheetLines(zip) {
    const shared = [];
    const ss = zip.file('xl/sharedStrings.xml');
    if (ss) {
        const xml = await ss.async('string');
        for (const si of xml.split(/<\/si>/)) {
            const parts = [...si.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1]));
            if (si.includes('<si')) shared.push(parts.join(''));
        }
    }
    const names = [];
    const wb = zip.file('xl/workbook.xml');
    if (wb) {
        const xml = await wb.async('string');
        for (const m of xml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)) names.push(decodeXml(m[1]));
    }
    const sheetFiles = Object.keys(zip.files)
        .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    const lines = [];
    for (let i = 0; i < sheetFiles.length; i++) {
        const xml = await zip.file(sheetFiles[i]).async('string');
        const sheetName = names[i] || `Sayfa${i + 1}`;
        for (const m of xml.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const attrs = m[1];
            const body = m[2] || '';
            const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
            const type = (attrs.match(/t="([a-zA-Z]+)"/) || [])[1];
            const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
            const f = (body.match(/<f[^>]*>([\s\S]*?)<\/f>/) || [])[1];
            let val;
            if (type === 's' && v !== undefined) val = shared[Number(v)];
            else if (type === 'inlineStr') val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => decodeXml(x[1])).join('');
            else if (v !== undefined) val = decodeXml(v);
            if (val === undefined || val === '') continue;
            lines.push(`${sheetName} · ${ref}: ${val}${f ? `   (=${decodeXml(f)})` : ''}`);
        }
    }
    return lines;
}

async function slideLines(zip) {
    const slides = Object.keys(zip.files)
        .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
    const lines = [];
    for (let i = 0; i < slides.length; i++) {
        const xml = await zip.file(slides[i]).async('string');
        for (const p of xml.split(/<\/a:p>/)) {
            const t = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1])).join('').trim();
            if (t) lines.push(`Slayt ${i + 1} · ${t}`);
        }
    }
    return lines;
}

// Karşılaştırma ve kelime sayımı için belgeyi paragraf/satır listesine çevirir.
async function extractLines(rel, buffer) {
    if (!buffer) return [];
    const k = kindOf(rel);
    try {
        if (k === 'word') {
            const zip = await JSZip.loadAsync(buffer);
            const doc = zip.file('word/document.xml');
            if (!doc) return [];
            const lines = paragraphsFromWordXml(await doc.async('string'));
            for (const extra of ['word/footnotes.xml', 'word/endnotes.xml']) {
                const f = zip.file(extra);
                if (f) {
                    const notes = paragraphsFromWordXml(await f.async('string'));
                    if (notes.length) lines.push(...notes.map(n => `[Dipnot] ${n}`));
                }
            }
            return lines;
        }
        if (k === 'sheet') return await sheetLines(await JSZip.loadAsync(buffer));
        if (k === 'slides') return await slideLines(await JSZip.loadAsync(buffer));
        if (k === 'text') return Buffer.from(buffer).toString('utf8').split(/\r?\n/);
    } catch (e) {
        // Bozuk/yarım kaydedilmiş dosya: sessizce boş dön
    }
    return null;
}

function countWordsInLines(lines) {
    let n = 0;
    for (const l of lines || []) {
        for (const w of l.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
    }
    return n;
}

async function countWords(rel, buffer) {
    if (!countsWords(rel)) return null;
    const lines = await extractLines(rel, buffer);
    return lines ? countWordsInLines(lines.filter(l => !l.startsWith('[Dipnot]'))) : null;
}

// Word'ün "WordOpenXML" (Flat OPC) çıktısını gerçek bir .docx dosyasına dönüştürür.
async function flatOpcToDocx(xml) {
    const zip = new JSZip();
    const overrides = [];
    const partRe = /<pkg:part\s([^>]*)>([\s\S]*?)<\/pkg:part>/g;
    let m;
    while ((m = partRe.exec(xml))) {
        const name = (m[1].match(/pkg:name="([^"]+)"/) || [])[1];
        const contentType = (m[1].match(/pkg:contentType="([^"]+)"/) || [])[1];
        if (!name) continue;
        const inner = m[2];
        const xmlData = inner.match(/<pkg:xmlData>([\s\S]*)<\/pkg:xmlData>/);
        const binData = inner.match(/<pkg:binaryData>([\s\S]*)<\/pkg:binaryData>/);
        const partPath = name.replace(/^\//, '');
        if (xmlData) {
            zip.file(partPath, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + xmlData[1].trim());
        } else if (binData) {
            zip.file(partPath, Buffer.from(binData[1].replace(/\s+/g, ''), 'base64'));
        } else {
            continue;
        }
        if (contentType && !name.endsWith('.rels')) overrides.push({ name, contentType });
    }
    if (!zip.file('word/document.xml')) throw new Error('Geçersiz Word içeriği');
    const ct = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        ...overrides.map(o => `<Override PartName="${o.name}" ContentType="${o.contentType}"/>`),
        '</Types>'
    ].join('');
    zip.file('[Content_Types].xml', ct);
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { kindOf, countsWords, extractLines, countWords, countWordsInLines, flatOpcToDocx, wordStructure };
