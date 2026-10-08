// Telefondaki depolama arka ucu: expo-file-system (SDK 57) File/Directory API'si üzerinde.
// Yollar düz mutlak yollardır ("/var/mobile/…"); her çağrıda file:// adresine çevrilir (paths.pathToUri).
// Kullanılan API (node_modules/expo-file-system/build/*.d.ts ile doğrulandı):
//   Paths.info(uri) → { exists, isDirectory }, Paths.document.uri
//   File: exists, size, modificationTime, bytes(), text(), write(u8|string, { append }), create(), delete(),
//         moveSync(dest, { overwrite })
//   Directory: exists, list() → (File|Directory)[] (.name), create({ intermediates, idempotent }), delete(),
//         info() → { modificationTime }
import { Directory, File, Paths } from 'expo-file-system';
import { plainBytes } from '../bytes.js';
import { libraryGitRootUri, pathToUri, uriToPath } from './paths.js';

export function backendExpo() {
  const uri = (p) => pathToUri(p);
  return {
    stat(p) {
      const u = uri(p);
      let info;
      try {
        info = Paths.info(u);
      } catch (e) {
        return null;
      }
      if (!info || !info.exists) return null;
      if (info.isDirectory) {
        let mtimeMs = 0;
        try {
          mtimeMs = new Directory(u).info().modificationTime || 0;
        } catch (e) {}
        return { type: 'dir', size: 0, mtimeMs };
      }
      const f = new File(u);
      return { type: 'file', size: f.size || 0, mtimeMs: f.modificationTime || 0 };
    },
    readBytes(p) {
      return new File(uri(p)).bytes();
    },
    readText(p) {
      return new File(uri(p)).text();
    },
    writeBytes(p, bytes) {
      const f = new File(uri(p));
      if (!f.exists) f.create();
      f.write(plainBytes(bytes));
    },
    append(p, text) {
      const f = new File(uri(p));
      if (!f.exists) f.create();
      f.write(text, { append: true });
    },
    rename(from, to) {
      new File(uri(from)).moveSync(new File(uri(to)), { overwrite: true });
    },
    list(p) {
      return new Directory(uri(p)).list().map((x) => x.name);
    },
    mkdirp(p) {
      new Directory(uri(p)).create({ intermediates: true, idempotent: true });
    },
    remove(p) {
      const u = uri(p);
      const info = Paths.info(u);
      if (info && info.isDirectory) new Directory(u).delete();
      else new File(u).delete();
    },
  };
}

// Git kök klasörü (Library/Application Support/DraftRewind/git) — yoksa oluşturulur. Düz yol döner.
export function ensureGitRoot() {
  const rootUri = libraryGitRootUri(Paths.document.uri);
  new Directory(rootUri).create({ intermediates: true, idempotent: true });
  return uriToPath(rootUri);
}

// Belgeler klasörünün düz yolu (çalışma klasörleri: Belgeler/Projeler/<ad>)
export const documentsPath = () => uriToPath(Paths.document.uri);
