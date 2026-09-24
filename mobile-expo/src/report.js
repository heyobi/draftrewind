// "Değişiklik raporu": bir kaydın Word/metin farklarını tek bir PDF'e döker (danışmana göndermek için).
// Farklar uygulamadaki gizli WebView'da hesaplanır (bkz. App.js DiffWorker; diffHtml report modu),
// buradaki HTML yalnızca statik biçimlendirmedir: expo-print sayfayı JS beklemeden çizer.
import * as Print from 'expo-print';
import { File } from 'expo-file-system';
import { t, locale } from './i18n';
import { hm } from './stats';

export const REPORT_MAX_FILES = 5;
export const REPORT_MAX_BLOCKS = 300;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Açık tema renkleri (diffHtml ile aynı)
const C = { text: '#1c1a33', dim: '#7c7a98', add: '#dcfce7', addT: '#15803d', del: '#fee2e2', delT: '#b91c1c', border: '#e6e3f3', accent: '#6c5cff' };

// items: [{ name, status, add, rem, html, failed, unchanged, truncated }]
export function reportHtml({ projectName, snapshot, items, totalFiles }) {
  const d = new Date(snapshot.time);
  const date = `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })} · ${hm(snapshot.time)}`;
  const truncatedFiles = totalFiles > items.length;
  const truncatedBlocks = items.some((it) => it.truncated);
  const sections = items
    .map((it) => {
      let body;
      if (it.failed) body = `<p class="note">${esc(t('report.failedFile'))}</p>`;
      else if (it.unchanged) body = `<p class="note">${esc(t('viewer.unchanged'))}</p>`;
      else body = `<div class="doc">${it.html}</div>`;
      const chips =
        (it.status === 'added' ? `<span class="chip n">${esc(t('snapshot.added'))}</span>` : '') +
        (it.add ? `<span class="chip a">+${it.add}</span>` : '') +
        (it.rem ? `<span class="chip d">−${it.rem}</span>` : '');
      return `<section><h2>${esc(it.name)}</h2><div class="sum">${chips}</div>${body}</section>`;
    })
    .join('');
  const notes = [truncatedFiles ? t('report.truncatedFiles', { n: items.length }) : '', truncatedBlocks ? t('report.truncatedBlocks', { n: REPORT_MAX_BLOCKS }) : ''].filter(Boolean);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:28px 32px;color:${C.text};font-family:-apple-system,system-ui,'Helvetica Neue',Arial,sans-serif;font-size:13px}
  h1{font-size:22px;margin:0 0 4px} .meta{color:${C.dim};font-size:12px;margin:0 0 18px} .meta b{color:${C.text};font-weight:600}
  .lead{font-size:13px;margin:0 0 22px;padding:10px 14px;border-left:3px solid ${C.accent};background:#f3f2fb;border-radius:6px}
  section{margin:0 0 26px;page-break-inside:auto} h2{font-size:15px;margin:0 0 6px;padding-top:8px;border-top:1px solid ${C.border}}
  .sum{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap}
  .chip{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px}
  .a{background:${C.add};color:${C.addT}} .d{background:${C.del};color:${C.delT}} .n{background:#f3f2fb;color:${C.dim}}
  .doc{font:12.5px/1.6 Georgia,'Times New Roman',serif} .doc p{margin:0 0 8px} .same{color:${C.dim}}
  .padd{background:${C.add};border-left:3px solid ${C.addT};padding:3px 8px;border-radius:4px}
  .pdel{background:${C.del};border-left:3px solid ${C.delT};padding:3px 8px;border-radius:4px;text-decoration:line-through;color:${C.dim}}
  ins{background:${C.add};color:${C.addT};text-decoration:none;font-weight:600;border-radius:3px}
  del{background:${C.del};color:${C.delT};border-radius:3px}
  .gap{text-align:center;color:${C.dim};font:11px -apple-system,sans-serif;margin:4px 0 10px}
  .note{color:${C.dim};font-style:italic}
  footer{margin-top:30px;padding-top:10px;border-top:1px solid ${C.border};color:${C.dim};font-size:11px}
</style></head><body>
<h1>${esc(t('report.title'))}</h1>
<p class="meta"><b>${esc(t('report.project'))}:</b> ${esc(projectName)} &nbsp;·&nbsp; <b>${esc(t('report.snapshot'))}:</b> ${esc(snapshot.title)} &nbsp;·&nbsp; <b>${esc(t('report.date'))}:</b> ${esc(date)}</p>
<p class="lead">${esc(t('report.summary', { n: totalFiles, count: totalFiles }))}${snapshot.note ? ' — ' + esc(snapshot.note) : ''}</p>
${sections}
<footer>${esc(t('report.footer'))}${notes.length ? '<br>' + notes.map(esc).join('<br>') : ''}</footer>
</body></html>`;
}

// HTML → PDF (expo-print). Dönen: Uint8Array; geçici dosya silinir.
export async function htmlToPdf(html) {
  const { uri } = await Print.printToFileAsync({ html });
  const f = new File(uri);
  try {
    return await f.bytes();
  } finally {
    try {
      if (f.exists) f.delete();
    } catch (e) {}
  }
}

// "Tez - 2026-09-25 değişiklikler.pdf"
export function reportFileName(projectName, time) {
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${t('report.fileName', { project: projectName, date })}.pdf`;
}
