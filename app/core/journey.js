/* DraftRewind — Yolculuk: kayıt geçmişinden zaman serisi, yazma oturumları ve küçük SVG grafikler.
 * UMD: ana süreçte `require('./core/journey')`, arayüzde `<script src="../core/journey.js">` (window.Journey).
 * Saf fonksiyonlar; bağımlılık yok. Aynı grafik hem Yolculuk sekmesinde hem yazarlık raporunda çizilir.
 */
(function (root) {
    const SESSION_GAP_MS = 45 * 60 * 1000;
    const DAY_MS = 24 * 3600 * 1000;

    function dayKey(t) {
        const d = new Date(t);
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    // Zaman damgalarını oturumlara ayırır: iki kayıt arasında gapMs'ten uzun boşluk varsa yeni oturum başlar.
    // Dönen: [{ start, end, count }] (eskiden yeniye)
    function clusterSessions(times, gapMs = SESSION_GAP_MS) {
        const sorted = (times || []).filter(t => typeof t === 'number' && !Number.isNaN(t)).sort((a, b) => a - b);
        const out = [];
        for (const t of sorted) {
            const last = out[out.length - 1];
            if (last && t - last.end <= gapMs) {
                last.end = t;
                last.count++;
            } else {
                out.push({ start: t, end: t, count: 1 });
            }
        }
        return out;
    }

    // Oturum istatistikleri: sayı, aktif gün, ortalama süre, en verimli saat, saat histogramı, en uzun seri
    function sessionStats(times, { gapMs = SESSION_GAP_MS } = {}) {
        const sessions = clusterSessions(times, gapMs);
        const hours = new Array(24).fill(0);
        const days = new Set();
        for (const t of times || []) {
            if (typeof t !== 'number' || Number.isNaN(t)) continue;
            hours[new Date(t).getHours()]++;
            days.add(dayKey(t));
        }
        let bestHour = null;
        let bestN = 0;
        for (let h = 0; h < 24; h++) {
            if (hours[h] > bestN) {
                bestN = hours[h];
                bestHour = h;
            }
        }
        // Tek kayıtlık oturum 0 dk sürer; ortalamada en az 5 dk sayılır (bir kayıt = en az kısa bir çalışma)
        const durations = sessions.map(s => Math.max(5 * 60 * 1000, s.end - s.start));
        const totalMs = durations.reduce((a, b) => a + b, 0);
        // En uzun ardışık gün serisi
        const dayList = [...days].map(k => {
            const [y, m, d] = k.split('-').map(Number);
            return new Date(y, m - 1, d).getTime();
        }).sort((a, b) => a - b);
        let longestStreak = 0;
        let run = 0;
        for (let i = 0; i < dayList.length; i++) {
            run = i > 0 && Math.round((dayList[i] - dayList[i - 1]) / DAY_MS) === 1 ? run + 1 : 1;
            if (run > longestStreak) longestStreak = run;
        }
        return {
            count: sessions.length,
            activeDays: days.size,
            avgMs: sessions.length ? Math.round(totalMs / sessions.length) : 0,
            totalMs,
            bestHour,
            hours,
            longestStreak,
            sessions
        };
    }

    // Geçmiş listesinden (yeniden eskiye ya da karışık) kronolojik seri: her noktada toplam kelime ve
    // dosya başına kelime haritası. Toplamı olmayan kayıtlarda (birleştirme, telefon) önceki değer taşınır.
    // history öğesi: { oid, time, kind, title, total?, words?, delta?, deleted?, changed? }
    function buildSeries(history) {
        const chron = [...(history || [])].sort((a, b) => a.time - b.time);
        const points = [];
        let words = {};
        let total = 0;
        for (const h of chron) {
            if (h.words && typeof h.words === 'object') {
                words = { ...h.words };
            } else {
                words = { ...words };
                for (const [p, d] of Object.entries(h.delta || {})) words[p] = Math.max(0, (words[p] || 0) + (Number(d) || 0));
            }
            for (const p of h.deleted || []) delete words[p];
            if (typeof h.total === 'number') total = h.total;
            else if (h.words || (h.delta && Object.keys(h.delta).length)) total = Object.values(words).reduce((a, b) => a + b, 0);
            points.push({ time: h.time, oid: h.oid, total, words, kind: h.kind || 'auto', title: h.title || '', changed: h.changed || null });
        }
        return points;
    }

    // Son durumda en çok kelimesi olan dosyalar (en fazla n)
    function topFiles(points, n = 8) {
        if (!points.length) return [];
        const last = points[points.length - 1].words || {};
        return Object.entries(last)
            .filter(([, w]) => w > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([rel]) => rel);
    }

    // Bölüm özeti (rapor ve sekme): ilk görülme, o zamanki ve şimdiki kelime, düzenleme sayısı
    function chapterStats(points, files) {
        return files.map(rel => {
            let firstSeen = null;
            let firstWords = 0;
            let edits = 0;
            for (const p of points) {
                if (p.words && p.words[rel] != null) {
                    if (firstSeen == null) {
                        firstSeen = p.time;
                        firstWords = p.words[rel];
                    }
                    if (p.changed && p.changed.includes(rel)) edits++;
                }
            }
            const last = points.length ? points[points.length - 1].words[rel] || 0 : 0;
            return { rel, firstSeen, firstWords, lastWords: last, edits };
        });
    }

    const escXml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // "Güzel" üst sınır: 1234 → 1500, 8200 → 10000
    function niceMax(v) {
        if (v <= 0) return 100;
        const p = Math.pow(10, Math.floor(Math.log10(v)));
        const f = v / p;
        const nice = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(s => f <= s) || 10;
        return nice * p;
    }

    // Kelime sayısı / zaman çizgi-alan grafiği (SVG dizesi). Renkler CSS değişkeniyle gelir; rapor kendi :root'unu tanımlar.
    // opts: { width, height, months: [..12 kısa ad], fmt: n => str, highlight: nokta indeksi, now, idPrefix, showLabels }
    function chartSvg(points, opts = {}) {
        const W = Math.max(280, Math.round(opts.width || 720));
        const H = Math.max(140, Math.round(opts.height || 220));
        const pad = { l: 46, r: 16, t: 38, b: 28 }; // üstte iki satır etiket için yer
        const iw = W - pad.l - pad.r;
        const ih = H - pad.t - pad.b;
        const months = opts.months || ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const fmt = opts.fmt || (n => String(n));
        const id = opts.idPrefix || 'jc';
        if (!points || points.length < 2) return `<svg class="j-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"></svg>`;
        const t0 = points[0].time;
        const t1 = Math.max(opts.now || 0, points[points.length - 1].time, t0 + 1);
        const yMax = niceMax(Math.max(...points.map(p => p.total)) * 1.08);
        const x = t => pad.l + ((t - t0) / (t1 - t0)) * iw;
        const y = v => pad.t + ih - (v / yMax) * ih;
        const parts = [];
        parts.push(`<svg class="j-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">`);
        parts.push(`<defs><linearGradient id="${id}-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity=".02"/></linearGradient></defs>`);
        // y ızgarası (4 çizgi)
        for (let i = 0; i <= 4; i++) {
            const v = (yMax / 4) * i;
            const yy = y(v);
            parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="var(--border)" stroke-width="1"/>`);
            parts.push(`<text x="${pad.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--text-3)">${escXml(fmt(Math.round(v)))}</text>`);
        }
        // Ay çentikleri: ilk aydan bugüne; sığmıyorsa seyrelt
        const d0 = new Date(t0);
        const ticks = [];
        for (let d = new Date(d0.getFullYear(), d0.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) ticks.push(d);
        const spanMonths = ticks.length;
        const step = spanMonths > iw / 56 ? Math.ceil(spanMonths / (iw / 56)) : 1;
        ticks.forEach((d, i) => {
            if (i % step) return;
            const xx = x(d.getTime());
            const label = d.getMonth() === 0 ? `${months[0]} ${d.getFullYear()}` : months[d.getMonth()];
            parts.push(`<line x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--border)" stroke-dasharray="2 4"/>`);
            parts.push(`<text x="${xx.toFixed(1)}" y="${H - 9}" text-anchor="middle" font-size="10.5" fill="var(--text-3)">${escXml(label)}</text>`);
        });
        if (!ticks.length) {
            parts.push(`<text x="${pad.l}" y="${H - 9}" font-size="10.5" fill="var(--text-3)">${escXml(`${d0.getDate()} ${months[d0.getMonth()]}`)}</text>`);
        }
        // Alan + çizgi (basamaklı: kayıtlar arasında değer sabittir)
        let line = '';
        points.forEach((p, i) => {
            const px = x(p.time).toFixed(1);
            const py = y(p.total).toFixed(1);
            if (i === 0) line += `M${px} ${py}`;
            else line += `H${px}V${py}`;
        });
        const lastX = x(t1).toFixed(1);
        const lastY = y(points[points.length - 1].total).toFixed(1);
        line += `H${lastX}`;
        const area = `${line}V${(pad.t + ih).toFixed(1)}H${x(t0).toFixed(1)}Z`;
        parts.push(`<path d="${area}" fill="url(#${id}-area)"/>`);
        parts.push(`<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>`);
        parts.push(`<circle cx="${lastX}" cy="${lastY}" r="3.5" fill="var(--accent)"/>`);
        // Kilometre taşları (işaretli anlar)
        const stars = points.map((p, i) => ({ p, i })).filter(o => o.p.kind === 'star');
        // Etiketler iki satıra dönüşümlü yazılır; yakın kilometre taşları üst üste binmez
        const lastLabelX = [-Infinity, -Infinity];
        stars.forEach(({ p, i }, k) => {
            const row = k % 2;
            const px = x(p.time);
            const py = y(p.total);
            const title = p.title || '';
            parts.push(`<g class="j-star" data-i="${i}"><title>${escXml(title)}</title>`);
            parts.push(`<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--orange)" stroke-width="1" stroke-dasharray="3 3"/>`);
            parts.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5" fill="var(--orange)" stroke="var(--surface)" stroke-width="2"/>`);
            if (opts.showLabels !== false && px - lastLabelX[row] > 40) {
                // Etiketler grafiğin üst satırında; bir sonraki kilometre taşına (ya da kenara) kadar olan boşluğa
                // sığacak kadar kısaltılır, sağda yer yoksa sola yazılır
                const next = stars[k + 2] ? x(stars[k + 2].p.time) : W - pad.r; // aynı satırdaki bir sonraki
                const prev = lastLabelX[row] > -Infinity ? lastLabelX[row] + 8 : pad.l;
                const need = title.length * 6.8 + 14;
                const roomR = next - px;
                const roomL = px - prev;
                const anchor = roomR >= need || roomR >= roomL ? 'start' : 'end';
                const room = anchor === 'end' ? roomL : roomR;
                const maxChars = Math.max(8, Math.min(40, Math.floor((room - 14) / 6.8)));
                const short = title.length > maxChars ? `${title.slice(0, maxChars - 1)}…` : title;
                parts.push(`<text x="${(px + (anchor === 'end' ? -8 : 8)).toFixed(1)}" y="${pad.t - 8 - row * 12}" text-anchor="${anchor}" font-size="10.5" font-weight="700" fill="var(--orange)">${escXml(short)}</text>`);
                lastLabelX[row] = px;
            }
            parts.push('</g>');
        });
        // Vurgu (kare kare)
        if (typeof opts.highlight === 'number' && points[opts.highlight]) {
            const p = points[opts.highlight];
            const px = x(p.time).toFixed(1);
            const py = y(p.total).toFixed(1);
            parts.push(`<line x1="${px}" x2="${px}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--accent)" stroke-width="1.5" stroke-opacity=".6"/>`);
            parts.push(`<circle cx="${px}" cy="${py}" r="7" fill="var(--accent)" fill-opacity=".18"/><circle cx="${px}" cy="${py}" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`);
        }
        parts.push('</svg>');
        return parts.join('');
    }

    // Mini çizgi (bölüm başına kelime sayısı)
    function sparkSvg(values, { width = 120, height = 28 } = {}) {
        const v = (values || []).map(n => Number(n) || 0);
        if (v.length < 2) return `<svg class="j-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"></svg>`;
        const max = Math.max(1, ...v);
        const step = (width - 4) / (v.length - 1);
        const pts = v.map((n, i) => `${(2 + i * step).toFixed(1)},${(height - 2 - (n / max) * (height - 4)).toFixed(1)}`);
        const area = `M${pts[0]} L${pts.join(' L')} L${(2 + (v.length - 1) * step).toFixed(1)},${height - 1} L2,${height - 1} Z`;
        return `<svg class="j-spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none"><path d="${area}" fill="var(--accent)" fill-opacity=".14"/><polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    }

    // Saat histogramı (24 çubuk)
    function hoursSvg(hours, { width = 240, height = 44, best = null } = {}) {
        const h = hours || new Array(24).fill(0);
        const max = Math.max(1, ...h);
        const bw = width / 24;
        const bars = h.map((n, i) => {
            const bh = Math.max(2, (n / max) * (height - 12));
            const fill = i === best ? 'var(--accent)' : 'var(--border)';
            return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(height - 12 - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${fill}"><title>${String(i).padStart(2, '0')}:00 · ${n}</title></rect>`;
        });
        const labels = [0, 6, 12, 18].map(i => `<text x="${(i * bw + 1).toFixed(1)}" y="${height - 1}" font-size="9.5" fill="var(--text-3)">${String(i).padStart(2, '0')}</text>`);
        return `<svg class="j-hours" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${bars.join('')}${labels.join('')}</svg>`;
    }

    const api = { SESSION_GAP_MS, clusterSessions, sessionStats, buildSeries, topFiles, chapterStats, chartSvg, sparkSvg, hoursSvg, niceMax, dayKey };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Journey = api;
})(typeof self !== 'undefined' ? self : this);
