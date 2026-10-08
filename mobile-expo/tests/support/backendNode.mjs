// Testler için depolama arka ucu: node:fs üzerinde (src/git/fsAdapter.js arayüzü).
import fs from 'node:fs';

export function backendNode() {
  return {
    stat(p) {
      try {
        const st = fs.statSync(p);
        return { type: st.isDirectory() ? 'dir' : 'file', size: st.size, mtimeMs: st.mtimeMs };
      } catch (e) {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
        throw e;
      }
    },
    readBytes(p) {
      const b = fs.readFileSync(p);
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    },
    readText(p) {
      return fs.readFileSync(p, 'utf8');
    },
    writeBytes(p, bytes) {
      fs.writeFileSync(p, bytes);
    },
    append(p, text) {
      const fd = fs.openSync(p, 'a');
      try {
        fs.writeSync(fd, text);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    },
    rename(from, to) {
      fs.renameSync(from, to);
    },
    list(p) {
      return fs.readdirSync(p);
    },
    mkdirp(p) {
      fs.mkdirSync(p, { recursive: true });
    },
    remove(p) {
      const st = fs.statSync(p);
      if (st.isDirectory()) fs.rmdirSync(p);
      else fs.unlinkSync(p);
    },
  };
}
