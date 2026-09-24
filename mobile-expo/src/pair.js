// QR ile eşleştirme (sunucu yok). Masaüstü bu bağlantıyı QR olarak gösterir (sözleşme, değiştirme):
//   draftrewind://pair?v=1&d=<base64url(JSON.stringify({ t: <github token>, l: <login>, e: <bitiş, epoch ms> }))>
// base64url: + → -, / → _, dolgu (=) yok.
// Bu modül bağımlılıksızdır (node ile test edilebilir). Jeton asla günlüğe yazılmaz.

export class PairError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'invalid' | 'expired'
  }
}

export function isPairLink(url) {
  return typeof url === 'string' && /^draftrewind:\/\/\/?pair(\?|$)/i.test(url.trim());
}

function queryParams(url) {
  const out = {};
  const q = url.split('?').slice(1).join('?').split('#')[0];
  for (const part of q.split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i);
    const v = i < 0 ? '' : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, '%20'));
    } catch (e) {
      out[k] = v;
    }
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// base64url → bayt dizisi (atob'a güvenmeden; geçersiz karakterde hata)
export function base64UrlToBytes(s) {
  const clean = String(s).trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new PairError('invalid');
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return bytes;
}

function utf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const x = bytes[i++];
    let cp;
    if (x < 0x80) cp = x;
    else if (x < 0xe0) cp = ((x & 0x1f) << 6) | (bytes[i++] & 0x3f);
    else if (x < 0xf0) cp = ((x & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    else cp = ((x & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

// Geçerliyse { token, login, expiresAt } döner; değilse PairError ('invalid' | 'expired') fırlatır.
export function decodePairLink(url, now = Date.now()) {
  if (!isPairLink(url)) throw new PairError('invalid');
  const q = queryParams(url.trim());
  if (q.v !== undefined && q.v !== '1') throw new PairError('invalid');
  if (!q.d) throw new PairError('invalid');
  let data;
  try {
    data = JSON.parse(utf8(base64UrlToBytes(q.d)));
  } catch (e) {
    throw new PairError('invalid');
  }
  if (!data || typeof data !== 'object') throw new PairError('invalid');
  const token = typeof data.t === 'string' ? data.t.trim() : '';
  const expiresAt = Number(data.e);
  if (!token || /\s/.test(token) || !Number.isFinite(expiresAt)) throw new PairError('invalid');
  if (now > expiresAt) throw new PairError('expired');
  return { token, login: typeof data.l === 'string' ? data.l : '', expiresAt };
}
