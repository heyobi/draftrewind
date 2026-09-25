// Yazarlık raporu: projenin gelişimini tek başına duran bir HTML sayfasına döker (ana süreç gizli bir
// pencerede PDF'e basar). Dış kaynak yok, betik yok; grafikler satır içi SVG (journey.js ile aynı çizim).
const J = require('./journey');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CSS = `
:root { --accent: #5242e6; --border: #d9d7e6; --text: #1c1a33; --text-2: #4b4963; --text-3: #7b799a; --orange: #ea580c; --surface: #ffffff; --soft: #f3f2fa; }
* { box-sizing: border-box; }
@page { size: A4; margin: 16mm 14mm; }
html, body { margin: 0; padding: 0; background: #fff; color: var(--text); font-family: "Segoe UI", system-ui, -apple-system, Arial, sans-serif; font-size: 11.5px; line-height: 1.45; }
h1 { font-size: 24px; margin: 0 0 2px; letter-spacing: -.02em; }
h2 { font-size: 14px; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--accent); letter-spacing: -.01em; }
h3 { font-size: 12px; margin: 0 0 4px; }
.head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
.head .brand { margin-left: auto; text-align: right; color: var(--text-3); font-size: 10.5px; }
.head .brand b { color: var(--accent); font-size: 13px; display: block; }
.sub { color: var(--text-2); font-size: 12px; }
.section { margin: 0 0 16px; page-break-inside: avoid; }
.break { page-break-before: always; }
.totals { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.tot { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--soft); }
.tot .v { font-size: 18px; font-weight: 800; letter-spacing: -.02em; }
.tot .l { font-size: 10px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.chart { border: 1px solid var(--border); border-radius: 8px; padding: 8px; }
svg { display: block; max-width: 100%; height: auto; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ms { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
.ms div { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; border-bottom: 1px dashed var(--border); }
.ms .d { color: var(--text-3); font-size: 10.5px; white-space: nowrap; min-width: 92px; font-variant-numeric: tabular-nums; }
.ms .w { margin-left: auto; color: var(--text-3); font-size: 10.5px; white-space: nowrap; }
.ex { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; page-break-inside: avoid; }
.ex .box { border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; background: var(--soft); }
.ex .box .lbl { font-size: 10px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.ex .box .lbl span { color: var(--text-3); font-weight: 500; text-transform: none; letter-spacing: 0; margin-left: 6px; }
.ex .box p { margin: 0; font-family: Cambria, Georgia, serif; font-size: 11.5px; line-height: 1.5; }
.ex .box p.empty { color: var(--text-3); font-style: italic; font-family: inherit; }
.two { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 11px; }
.kv b { color: var(--text-2); font-weight: 600; }
.foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--border); color: var(--text-2); font-size: 10.5px; page-break-inside: avoid; }
.foot code { font-family: Consolas, monospace; font-size: 10px; background: var(--soft); padding: 1px 4px; border-radius: 4px; }
.foot .note { margin-top: 6px; color: var(--text-3); }
`;

function fmtDate(T, ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const months = T('time.months');
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDuration(T, ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return T('journey.minutes', { n: m });
    return T('journey.hoursMin', { h: Math.floor(m / 60), m: m % 60 });
}

// data: { lang, name, period: { from, to }, github, firstOid, lastOid, totals, points, sessions, milestones, chapters, excerpts, now }
function buildReportHtml(data, T) {
    const num = n => Number(n || 0).toLocaleString(T('locale'));
    const base = s => s.split('/').pop();
    const months = T('time.months').map(m => (m.length > 3 ? m.slice(0, 3) : m));
    const chart = J.chartSvg(data.points, { width: 720, height: 230, months, fmt: num, now: data.now, idPrefix: 'rp' });
    const st = data.sessions || {};
    const hours = J.hoursSvg(st.hours, { width: 300, height: 60, best: st.bestHour });
    const totals = data.totals || {};
    const totalCells = [
        [num(totals.snapshots), T('report.snapshots')],
        [num(totals.sessions), T('report.sessions')],
        [num(totals.activeDays), T('report.activeDays')],
        [num(totals.totalWords), T('report.wordsNow')],
        [`+${num(totals.added)}`, T('report.wordsAdded')],
        [totals.removed ? `−${num(totals.removed)}` : '0', T('report.wordsRemoved')]
    ];
    const milestones = (data.milestones || []).slice(0, 12);
    const chapters = (data.chapters || []).slice(0, 10);
    const excerpts = (data.excerpts || []).slice(0, 3);
    const gh = data.github;
    const hash = o => (o ? `<code>${esc(String(o).slice(0, 12))}</code>` : '—');

    return `<!DOCTYPE html><html lang="${esc(data.lang || 'tr')}"><head><meta charset="utf-8"><title>${esc(T('report.title'))} — ${esc(data.name)}</title><style>${CSS}</style></head><body>
<div class="head">
    <div>
        <h1>${esc(data.name)}</h1>
        <div class="sub">${esc(T('report.title'))} · ${esc(T('report.period', { from: fmtDate(T, data.period && data.period.from), to: fmtDate(T, data.period && data.period.to) }))}</div>
    </div>
    <div class="brand"><b>DraftRewind</b>${esc(T('report.generated', { date: fmtDate(T, data.now || Date.now()) }))}</div>
</div>

<div class="section">
    <div class="totals">${totalCells.map(([v, l]) => `<div class="tot"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('')}</div>
</div>

<div class="section">
    <h2>${esc(T('report.chartTitle'))}</h2>
    <div class="chart">${chart}</div>
    <div class="sub" style="margin-top:4px;font-size:10.5px">${esc(T('report.chartHint'))}</div>
</div>

<div class="section">
    <h2>${esc(T('report.milestones'))}</h2>
    ${milestones.length
        ? `<div class="ms">${milestones.map(m => `<div><span class="d">${esc(fmtDate(T, m.time))}</span><span>${esc(m.title)}</span><span class="w">${esc(T('common.words', { n: num(m.total) }))}</span></div>`).join('')}</div>`
        : `<div class="sub">${esc(T('report.noMilestones'))}</div>`}
</div>

<div class="section">
    <h2>${esc(T('report.chapters'))}</h2>
    <table>
        <thead><tr><th>${esc(T('report.colFile'))}</th><th>${esc(T('report.colFirstSeen'))}</th><th class="n">${esc(T('report.colWordsThen'))}</th><th class="n">${esc(T('report.colWordsNow'))}</th><th class="n">${esc(T('report.colEdits'))}</th></tr></thead>
        <tbody>${chapters.map(c => `<tr><td>${esc(base(c.rel))}</td><td>${esc(fmtDate(T, c.firstSeen))}</td><td class="n">${num(c.firstWords)}</td><td class="n">${num(c.lastWords)}</td><td class="n">${num(c.edits)}</td></tr>`).join('') || `<tr><td colspan="5" class="sub">—</td></tr>`}</tbody>
    </table>
</div>

${excerpts.length ? `<div class="section">
    <h2>${esc(T('report.excerpts'))}</h2>
    <div class="sub" style="margin-bottom:8px">${esc(T('report.excerptsHint'))}</div>
    ${excerpts.map(e => `<h3>${esc(base(e.rel))}</h3><div class="ex">
        <div class="box"><div class="lbl">${esc(T('report.firstVersion'))}<span>${esc(fmtDate(T, e.first && e.first.time))}</span></div>${e.first && e.first.text ? `<p>${esc(e.first.text)}</p>` : `<p class="empty">${esc(T('report.noText'))}</p>`}</div>
        <div class="box"><div class="lbl">${esc(T('report.latestVersion'))}<span>${esc(fmtDate(T, e.last && e.last.time))}</span></div>${e.last && e.last.text ? `<p>${esc(e.last.text)}</p>` : `<p class="empty">${esc(T('report.noText'))}</p>`}</div>
    </div>`).join('')}
</div>` : ''}

<div class="section">
    <h2>${esc(T('report.habits'))}</h2>
    <div class="two">
        <div>
            <h3>${esc(T('journey.hourHist'))}</h3>
            ${hours}
            <div class="sub" style="font-size:10.5px">${esc(st.bestHour != null ? T('report.bestHourLine', { hour: `${String(st.bestHour).padStart(2, '0')}:00` }) : '—')}</div>
        </div>
        <div class="kv">
            <b>${esc(T('journey.sessionCount'))}</b><span>${num(st.count)}</span>
            <b>${esc(T('journey.activeDays'))}</b><span>${num(st.activeDays)}</span>
            <b>${esc(T('journey.avgSession'))}</b><span>${esc(fmtDuration(T, st.avgMs || 0))}</span>
            <b>${esc(T('journey.longestStreak'))}</b><span>${esc(T('stat.days', { n: num(st.longestStreak || 0), count: st.longestStreak || 0 }))}</span>
            <b>${esc(T('report.totalTime'))}</b><span>${esc(fmtDuration(T, st.totalMs || 0))}</span>
        </div>
    </div>
</div>

<div class="foot">
    <b>${esc(T('report.verification'))}</b>
    <div class="kv" style="margin-top:4px">
        <b>${esc(T('report.repo'))}</b><span>${gh && gh.owner && gh.repo ? `<code>${esc(gh.owner)}/${esc(gh.repo)}</code>` : esc(T('report.noRepo'))}</span>
        <b>${esc(T('report.firstCommit'))}</b><span>${hash(data.firstOid)} · ${esc(fmtDate(T, data.period && data.period.from))}</span>
        <b>${esc(T('report.lastCommit'))}</b><span>${hash(data.lastOid)} · ${esc(fmtDate(T, data.period && data.period.to))}</span>
    </div>
    <div class="note">${esc(T('report.verifyNote'))}</div>
</div>
</body></html>`;
}

// Bir belgenin ilk paragrafından kısa alıntı (~max karakter); başlık satırlarını atlar.
// avoid: bu metinle başlayan paragraf atlanır (ilk ve son sürüm aynı paragrafı göstermesin);
// hiç farklı paragraf yoksa belgenin son uzun paragrafı alınır.
function excerptFromLines(lines, max = 300, avoid = '') {
    if (!lines || !lines.length) return '';
    const paras = lines.map(l => String(l || '').trim()).filter(s => s && !s.startsWith('[Dipnot]') && s.split(/\s+/).length >= 8);
    const head = avoid ? String(avoid).replace(/…$/, '').slice(0, 80) : '';
    let text = paras.find(s => !head || !s.startsWith(head)) || '';
    if (!text && paras.length) text = paras[paras.length - 1];
    if (!text) text = String(lines.find(l => String(l || '').trim()) || '').trim();
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return `${cut.slice(0, sp > max * 0.6 ? sp : max)}…`;
}

module.exports = { buildReportHtml, excerptFromLines };
