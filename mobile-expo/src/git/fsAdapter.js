// isomorphic-git'in beklediği Node tarzı `fs` nesnesi (fs.promises), küçük bir DEPOLAMA ARKA UCU üzerine kurulur.
// Arka uç arayüzü (hepsi eşzamanlı ya da Promise döndürebilir; yollar '/' ile ayrılmış mutlak yollardır):
//   stat(path)            → { type: 'file' | 'dir', size, mtimeMs, mode? } | null (yoksa)
//   readBytes(path)       → Uint8Array            (dosya var)
//   readText(path)        → string  (isteğe bağlı; yoksa readBytes + UTF-8 çözümü)
//   writeBytes(path, u8)  → void                  (üst klasör var; dosyayı oluşturur ya da üzerine yazar)
//   append(path, text)    → void  (isteğe bağlı; günlük dosyası için)
//   rename(from, to)      → void  (isteğe bağlı; atomik yazma için, hedefin üzerine yazar)
//   list(path)            → string[] (klasördeki adlar)
//   mkdirp(path)          → void
//   remove(path)          → void  (dosya ya da BOŞ klasör)
// isomorphic-git hata kodlarına bakar (ENOENT, ENOTDIR, EEXIST, ENOTEMPTY); bu kodlar burada üretilir.
import { Buffer } from 'buffer';
import { utf8Decode, utf8Encode } from '../wsCore.js';

export function fsError(code, syscall, path) {
  const e = new Error(`${code}: ${syscall} '${path}'`);
  e.code = code;
  e.errno = code;
  e.syscall = syscall;
  e.path = path;
  return e;
}

// "a/b/" → "a/b", "C:\\x\\y" → "C:/x/y"
export function normPath(p) {
  let s = String(p).replace(/\\/g, '/');
  while (s.length > 1 && s.endsWith('/') && !/^[a-zA-Z]:\/$/.test(s)) s = s.slice(0, -1);
  return s.replace(/\/{2,}/g, '/');
}

export function dirnameOf(p) {
  const s = normPath(p);
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  const d = s.slice(0, i);
  return /^[a-zA-Z]:$/.test(d) ? `${d}/` : d;
}

export const joinPath = (...parts) => normPath(parts.filter((x) => x !== '' && x != null).join('/'));

const encodingOf = (opts) => (typeof opts === 'string' ? opts : opts && opts.encoding) || null;

function makeStats(st) {
  const isDir = st.type === 'dir';
  const mtimeMs = Number(st.mtimeMs) || 0;
  const mode = st.mode || (isDir ? 0o40000 : 0o100644);
  return {
    type: isDir ? 'dir' : 'file',
    mode,
    size: Number(st.size) || 0,
    ino: 0,
    uid: 0,
    gid: 0,
    dev: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    mtime: new Date(mtimeMs),
    ctime: new Date(mtimeMs),
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isSymbolicLink: () => false,
  };
}

export function createFs(backend) {
  const stat0 = async (path) => {
    const st = await backend.stat(path);
    return st || null;
  };
  // Üst klasör denetimi: yoksa ENOENT, dosyaysa ENOTDIR
  const checkParent = async (path, syscall) => {
    const parent = dirnameOf(path);
    if (parent === path) return;
    const st = await stat0(parent);
    if (!st) throw fsError('ENOENT', syscall, path);
    if (st.type !== 'dir') throw fsError('ENOTDIR', syscall, path);
  };

  const promises = {
    async readFile(path, opts) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'open', path);
      if (st.type === 'dir') throw fsError('EISDIR', 'read', path);
      const enc = encodingOf(opts);
      if (enc === 'utf8' || enc === 'utf-8') {
        if (backend.readText) return backend.readText(path);
        return utf8Decode(await backend.readBytes(path));
      }
      const bytes = await backend.readBytes(path);
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    },

    async writeFile(path, data, opts) {
      path = normPath(path);
      await checkParent(path, 'open');
      const st = await stat0(path);
      if (st && st.type === 'dir') throw fsError('EISDIR', 'open', path);
      let bytes = data;
      if (typeof data === 'string') bytes = utf8Encode(data);
      else if (!(data instanceof Uint8Array)) bytes = new Uint8Array(data);
      void opts;
      await backend.writeBytes(path, bytes);
    },

    async unlink(path) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'unlink', path);
      if (st.type === 'dir') throw fsError('EPERM', 'unlink', path);
      await backend.remove(path);
    },

    async readdir(path) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'scandir', path);
      if (st.type !== 'dir') throw fsError('ENOTDIR', 'scandir', path);
      return [...(await backend.list(path))];
    },

    async mkdir(path, opts) {
      path = normPath(path);
      const recursive = !!(opts && typeof opts === 'object' && opts.recursive);
      const st = await stat0(path);
      if (st) {
        if (recursive && st.type === 'dir') return undefined;
        throw fsError('EEXIST', 'mkdir', path);
      }
      if (!recursive) await checkParent(path, 'mkdir');
      await backend.mkdirp(path);
      return undefined;
    },

    // Tek parametreli: isomorphic-git özyinelemeli silmeyi kendi yapar (rmRecursive)
    async rmdir(path) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'rmdir', path);
      if (st.type !== 'dir') throw fsError('ENOTDIR', 'rmdir', path);
      if ((await backend.list(path)).length) throw fsError('ENOTEMPTY', 'rmdir', path);
      await backend.remove(path);
    },

    async stat(path) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'stat', path);
      return makeStats(st);
    },

    async lstat(path) {
      return promises.stat(path);
    },

    // Telefonda sembolik bağ yok
    async readlink(path) {
      path = normPath(path);
      const st = await stat0(path);
      if (!st) throw fsError('ENOENT', 'readlink', path);
      throw fsError('EINVAL', 'readlink', path);
    },

    async symlink(target, path) {
      throw fsError('ENOSYS', 'symlink', normPath(path));
    },

    async chmod() {},
  };

  // isomorphic-git `promises` özelliği "enumerable" ise onu kullanır
  return { promises };
}

// Arka uç üzerinde yardımcılar (motor kendi dosyaları için kullanır)
export async function writeAtomic(backend, path, bytes) {
  const data = typeof bytes === 'string' ? utf8Encode(bytes) : bytes;
  await backend.mkdirp(dirnameOf(path));
  if (!backend.rename) return backend.writeBytes(path, data);
  const tmp = `${path}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
  await backend.writeBytes(tmp, data);
  await backend.rename(tmp, path);
}

export async function readTextOrNull(backend, path) {
  try {
    const st = await backend.stat(path);
    if (!st || st.type !== 'file') return null;
    if (backend.readText) return await backend.readText(path);
    return utf8Decode(await backend.readBytes(path));
  } catch (e) {
    return null;
  }
}

export async function appendText(backend, path, text) {
  if (backend.append) return backend.append(path, text);
  const prev = (await readTextOrNull(backend, path)) || '';
  return writeAtomic(backend, path, prev + text);
}
