// isomorphic-git HttpClient: React Native'in fetch'i akış (stream) gövdesi desteklemez.
// İstek gövdesi (async iterable) tek bir Uint8Array'e toplanır, yanıt da tek parça olarak döner.
// Node testlerinde aynı istemci Node'un global fetch'i ile çalışır.

async function collect(body) {
  if (!body) return undefined;
  if (body instanceof Uint8Array) return body;
  const chunks = [];
  let size = 0;
  if (typeof body[Symbol.asyncIterator] === 'function' || typeof body[Symbol.iterator] === 'function') {
    for await (const c of body) {
      const u8 = c instanceof Uint8Array ? c : new Uint8Array(c);
      chunks.push(u8);
      size += u8.byteLength;
    }
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function* once(u8) {
  if (u8 && u8.byteLength) yield u8;
}

// fetchImpl: varsayılan genel fetch (testte değiştirilebilir)
export function makeHttp(fetchImpl) {
  return {
    async request({ url, method = 'GET', headers = {}, body }) {
      const f = fetchImpl || globalThis.fetch;
      const data = await collect(body);
      const res = await f(url, { method, headers, body: data });
      const buf = new Uint8Array(await res.arrayBuffer());
      const outHeaders = {};
      if (res.headers && typeof res.headers.forEach === 'function') {
        res.headers.forEach((value, key) => {
          outHeaders[key] = value;
        });
      }
      return {
        url: res.url || url,
        method,
        statusCode: res.status,
        statusMessage: res.statusText || '',
        headers: outHeaders,
        body: once(buf),
      };
    },
  };
}

export const http = makeHttp();

// GitHub: belirteç kullanıcı adı, parola "x-oauth-basic" (masaüstündeki github.js onAuth ile aynı)
export const onAuth = (token) => () => ({ username: token, password: 'x-oauth-basic' });
