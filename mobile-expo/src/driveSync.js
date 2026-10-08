// Telefondaki Drive projesi: Google Drive API üzerinde iki katman.
//   historyStore : .draftrewind/{packs,heads} — git geçmişi (masaüstündeki ApiRemote.historyStore ile aynı düzen)
//   driveRemote  : okunabilir dosyalar + _Sürümler (src/git/mirror.js bunu kullanır; masaüstü ApiRemote ile aynı)
import { fileType } from './files';
import { lang } from './i18n';
import { versionName, versionDirParts, VERSIONS_FOLDER } from './localCore';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const HISTORY_DIR = '.draftrewind';
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const byCreated = (a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || ''));
const nfc = (s) => {
  try {
    return String(s).normalize('NFC');
  } catch (e) {
    return String(s);
  }
};
const starTag = () => (lang() === 'tr' ? 'yıldızlı' : 'starred');

export function historyStore(drive, folderId) {
  const files = new Map(); // ad → kimlik
  let target = null;
  const folders = async (name, parent) => (await drive.query(`'${parent}' in parents and trashed=false and mimeType='${FOLDER_MIME}' and name='${esc(name)}'`, 'files(id,name,createdTime)')).sort(byCreated);
  const ensure = async () => {
    if (target) return target;
    const dr = (await folders(HISTORY_DIR, folderId))[0] || (await drive.createFolder(HISTORY_DIR, folderId));
    const sub = async (name) => ((await folders(name, dr.id))[0] || (await drive.createFolder(name, dr.id))).id;
    target = { packs: await sub('packs'), heads: await sub('heads') };
    return target;
  };
  return {
    id: 'drive',
    async list() {
      files.clear();
      const out = [];
      for (const dr of await folders(HISTORY_DIR, folderId)) {
        for (const sub of ['packs', 'heads']) {
          for (const d of await folders(sub, dr.id)) {
            for (const f of await drive.query(`'${d.id}' in parents and trashed=false`, 'files(id,name,createdTime)')) {
              const n = `${sub}/${f.name}`;
              if (files.has(n)) continue;
              files.set(n, f.id);
              out.push(n);
            }
          }
        }
      }
      return out;
    },
    async read(name) {
      const id = files.get(name);
      return id ? new Uint8Array(await drive.download(id)) : null;
    },
    async write(name, bytes) {
      const t = await ensure();
      const [sub, fileName] = name.split('/');
      const r = await drive.put({ id: files.get(name), name: fileName, parentId: sub === 'packs' ? t.packs : t.heads, bytes, mimeType: 'application/octet-stream' });
      files.set(name, r.id);
    },
  };
}

export function driveRemote(drive, folderId) {
  const files = new Map(); // rel → { id, parent }
  const dirs = new Map([['', folderId]]);
  const dirId = async (relDir) => {
    if (dirs.has(relDir)) return dirs.get(relDir);
    const parts = relDir.split('/');
    const parent = await dirId(parts.slice(0, -1).join('/'));
    const name = parts[parts.length - 1];
    const found = (await drive.query(`'${parent}' in parents and trashed=false and mimeType='${FOLDER_MIME}' and name='${esc(name)}'`, 'files(id,createdTime)')).sort(byCreated)[0];
    const id = found ? found.id : (await drive.createFolder(name, parent)).id;
    dirs.set(relDir, id);
    return id;
  };
  const mimeOf = (rel) => fileType(rel).mimeType || 'application/octet-stream';
  return {
    async list() {
      files.clear();
      const out = new Map();
      const queue = [['', folderId]];
      while (queue.length) {
        const [rel, id] = queue.shift();
        for (const f of await drive.query(`'${id}' in parents and trashed=false`)) {
          const name = nfc(f.name);
          if (!name || name.startsWith('.') || name.startsWith('~$')) continue;
          const r = rel ? `${rel}/${name}` : name;
          if (f.mimeType === FOLDER_MIME) {
            if (!rel && name === nfc(VERSIONS_FOLDER)) {
              dirs.set(VERSIONS_FOLDER, f.id);
              continue;
            }
            dirs.set(r, f.id);
            queue.push([r, f.id]);
          } else if (f.md5Checksum) {
            // Google Dokümanlar biçimindeki dosyaların md5'i yok: onlar bu katmanın dışında
            files.set(r, { id: f.id, parent: id });
            out.set(r, { md5: f.md5Checksum, size: Number(f.size) || 0 });
          }
        }
      }
      return out;
    },
    async read(rel) {
      return new Uint8Array(await drive.download(files.get(rel).id));
    },
    async write(rel, bytes) {
      const existing = files.get(rel);
      const parent = existing ? existing.parent : await dirId(rel.split('/').slice(0, -1).join('/'));
      const r = await drive.put({ id: existing && existing.id, name: rel.split('/').pop(), parentId: parent, bytes, mimeType: mimeOf(rel) });
      files.set(rel, { id: r.id, parent });
      return r.md5Checksum;
    },
    async version(rel, bytes, kind) {
      const parent = await dirId(versionDirParts(rel).join('/'));
      await drive.put({ name: versionName(rel, kind, { starTag: starTag() }), parentId: parent, bytes, mimeType: mimeOf(rel) });
    },
    async archive(rel) {
      const f = files.get(rel);
      const target = await dirId(versionDirParts(rel).join('/'));
      await drive.move(f.id, target, f.parent, versionName(rel, 'auto', { suffix: ' (silindi)' }));
      files.delete(rel);
    },
  };
}
