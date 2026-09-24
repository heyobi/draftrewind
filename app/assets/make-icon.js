// DraftRewind simgesi: geri saran dairesel ok + saat kolları.
// Kullanım: node app/assets/make-icon.js [boyut] [çıktı.png] [square]
// Masaüstü: varsayılan (256, yuvarlak köşe). iOS: 1024 ... square (köşeleri iOS yuvarlar).
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const N = Number(process.argv[2] || 256), SQUARE = process.argv[4] === 'square', px = Buffer.alloc(N * N * 4);
const seg = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - ax - t * dx, y - ay - t * dy); };
const clamp = v => Math.max(0, Math.min(1, v));
const cx = 0.5, cy = 0.52, R = 0.27, W = 0.034;
const deg = d => (d * Math.PI) / 180;
// Yay 165°'den saat yönünün tersine 460°'ye (=100°) kadar gider; ok ucu 100°'de
const A0 = deg(165), A1 = deg(100 + 360);
const pt = a => [cx + R * Math.cos(a), cy - R * Math.sin(a)];
const [ex, ey] = pt(A1);
const tan = [-Math.sin(A1), -Math.cos(A1)]; // saat yönünün tersine teğet (görüntü koordinatı)
const nor = [Math.cos(A1), -Math.sin(A1)];
const tip = [ex + tan[0] * 0.095, ey + tan[1] * 0.095];
const b1 = [ex + nor[0] * 0.085 - tan[0] * 0.01, ey + nor[1] * 0.085 - tan[1] * 0.01];
const b2 = [ex - nor[0] * 0.085 - tan[0] * 0.01, ey - nor[1] * 0.085 - tan[1] * 0.01];
function triDist(x, y) {
    // üçgen içi: negatif mesafe
    const e = [[tip, b1], [b1, b2], [b2, tip]];
    let inside = true, dmin = 1e9;
    for (const [p, q] of e) {
        const cross = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
        const s = Math.sign((b1[0] - tip[0]) * (b2[1] - tip[1]) - (b1[1] - tip[1]) * (b2[0] - tip[0]));
        if (cross * s < 0) inside = false;
        dmin = Math.min(dmin, seg(x, y, p[0], p[1], q[0], q[1]));
    }
    return inside ? -dmin : dmin;
}
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, y = (j + 0.5) / N;
    const r = 0.22, qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
    const d = SQUARE ? -1 : Math.hypot(qx, qy) - r;
    const a = clamp(0.5 - d * N);
    const t = clamp((x + y) / 2);
    let Rr = 108 + (236 - 108) * t, G = 92 + (98 - 92) * t, B = 255 + (190 - 255) * t;
    // yay
    let ang = Math.atan2(cy - y, x - cx);
    while (ang < A0) ang += 2 * Math.PI;
    let arc = ang <= A1 ? Math.abs(Math.hypot(x - cx, y - cy) - R) - W : 1;
    const [sx, sy] = pt(A0);
    arc = Math.min(arc, Math.hypot(x - sx, y - sy) - W);
    // saat kolları
    const hands = Math.min(seg(x, y, cx, cy, cx, cy - 0.13), seg(x, y, cx, cy, cx + 0.085, cy + 0.06)) - 0.026;
    const shape = Math.min(arc, triDist(x, y), hands);
    const white = clamp(0.5 - shape * N);
    Rr += (255 - Rr) * white; G += (255 - G) * white; B += (255 - B) * white;
    const o = (j * N + i) * 4; px[o] = Rr; px[o + 1] = G; px[o + 2] = B; px[o + 3] = a * 255;
}
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let j = 0; j < N; j++) { raw[j * (N * 4 + 1)] = 0; px.copy(raw, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(process.argv[3] || path.join(__dirname, 'icon.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('simge yazıldı');
