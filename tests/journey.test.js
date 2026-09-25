// Yolculuk: oturum kümeleme, zaman serisi, bölüm istatistikleri ve grafik çıktısı (saf mantık)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const J = require('../app/core/journey');

const MIN = 60 * 1000;
const base = new Date(2026, 8, 1, 21, 0).getTime(); // 1 Eylül 2026 21:00 (yerel)

test('clusterSessions: 45 dakikadan uzun boşluk yeni oturum başlatır, sıra önemsiz', () => {
    const times = [base + 50 * MIN, base, base + 10 * MIN, base + 120 * MIN, base + 130 * MIN];
    const s = J.clusterSessions(times);
    assert.equal(s.length, 2);
    assert.deepEqual(s[0], { start: base, end: base + 50 * MIN, count: 3 });
    assert.deepEqual(s[1], { start: base + 120 * MIN, end: base + 130 * MIN, count: 2 });
    assert.deepEqual(J.clusterSessions([]), []);
    assert.deepEqual(J.clusterSessions([base, null, NaN]), [{ start: base, end: base, count: 1 }]);
});

test('sessionStats: aktif gün, en verimli saat, ortalama süre ve en uzun seri', () => {
    const DAY = 24 * 3600 * 1000;
    const times = [];
    // 3 ardışık gün akşam 21:00–21:30, sonra bir gün boşluk, sonra sabah 09:00 tek kayıt
    for (let d = 0; d < 3; d++) times.push(base + d * DAY, base + d * DAY + 30 * MIN);
    times.push(base + 4 * DAY - 12 * 3600 * 1000);
    const st = J.sessionStats(times);
    assert.equal(st.count, 4);
    assert.equal(st.activeDays, 4);
    assert.equal(st.bestHour, 21);
    assert.equal(st.hours[21], 6);
    assert.equal(st.hours[9], 1);
    assert.equal(st.longestStreak, 3);
    // (30+30+30+5) / 4 dk
    assert.equal(st.avgMs, Math.round((95 * MIN) / 4));
    assert.equal(J.sessionStats([]).bestHour, null);
});

test('buildSeries: toplam taşınır, words yoksa delta uygulanır, silinen dosya düşer', () => {
    const hist = [
        { oid: 'c', time: 3000, kind: 'merge', title: 'telefondan', deleted: [] },
        { oid: 'b', time: 2000, kind: 'auto', title: 'b', delta: { 'a.docx': 50, 'b.docx': 20 }, deleted: [], changed: ['a.docx', 'b.docx'] },
        { oid: 'a', time: 1000, kind: 'star', title: 'ilk', total: 100, words: { 'a.docx': 100 }, deleted: [], changed: ['a.docx'] },
        { oid: 'd', time: 4000, kind: 'auto', title: 'd', total: 150, words: { 'a.docx': 150 }, delta: { 'b.docx': -20 }, deleted: ['b.docx'], changed: [] }
    ];
    const pts = J.buildSeries(hist);
    assert.deepEqual(pts.map(p => p.oid), ['a', 'b', 'c', 'd']);
    assert.deepEqual(pts.map(p => p.total), [100, 170, 170, 150]);
    assert.deepEqual(pts[1].words, { 'a.docx': 150, 'b.docx': 20 });
    assert.deepEqual(pts[2].words, { 'a.docx': 150, 'b.docx': 20 });
    assert.deepEqual(pts[3].words, { 'a.docx': 150 });
    assert.deepEqual(J.topFiles(pts), ['a.docx']);
    const ch = J.chapterStats(pts, ['a.docx', 'b.docx']);
    assert.deepEqual(ch[0], { rel: 'a.docx', firstSeen: 1000, firstWords: 100, lastWords: 150, edits: 2 });
    assert.deepEqual(ch[1], { rel: 'b.docx', firstSeen: 2000, firstWords: 20, lastWords: 0, edits: 1 });
});

test('chartSvg: kilometre taşı başlığı, ay çentikleri ve vurgu; azla veri boş svg', () => {
    const t0 = new Date(2026, 5, 10).getTime();
    const pts = [
        { time: t0, total: 100, kind: 'auto', title: 'a' },
        { time: t0 + 20 * 86400000, total: 1200, kind: 'star', title: 'Danışmana gönderildi <1>' },
        { time: t0 + 80 * 86400000, total: 4300, kind: 'auto', title: 'c' }
    ];
    const svg = J.chartSvg(pts, { width: 700, height: 220, months: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'], fmt: n => n.toLocaleString('tr-TR'), highlight: 1 });
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('<title>Danışmana gönderildi &lt;1&gt;</title>'));
    assert.ok(svg.includes('>Tem<') && svg.includes('>Ağu<'));
    assert.ok(svg.includes('5.000'));
    assert.ok(svg.includes('r="7"'), 'vurgu halkası');
    assert.ok(!J.chartSvg([pts[0]], { width: 400 }).includes('<path'));
    assert.equal(J.niceMax(1234), 1500);
    assert.equal(J.niceMax(5872), 6000);
    assert.equal(J.niceMax(8200), 10000);
});

test('sparkSvg ve hoursSvg', () => {
    const s = J.sparkSvg([0, 10, 5, 20]);
    assert.ok(s.includes('<polyline'));
    assert.ok(!J.sparkSvg([3]).includes('<polyline'));
    const h = J.hoursSvg(new Array(24).fill(0).map((_, i) => (i === 21 ? 9 : 1)), { best: 21 });
    assert.equal((h.match(/<rect/g) || []).length, 24);
    assert.ok(h.includes('21:00 · 9'));
});
