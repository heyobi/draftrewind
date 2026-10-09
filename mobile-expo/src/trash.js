// Silinenler: bu cihazdan kaldırılan projeler 30 gün burada bekler (geri yüklenebilir ya da kalıcı silinir).
// Yer: Library/Application Support/DraftRewind/trash/<kimlik>/{files, git, history, meta.json} — Dosyalar'da
// görünmez. Taşıma aynı birimde yapılır (kopya yok, anında). Buluttaki kopyalara hiç dokunulmaz.
import { Directory, File } from 'expo-file-system';
import { ensureGitRoot, pathToUri } from './git';

export const KEEP_DAYS = 30;
const DAY = 86400000;

const trashRoot = () => {
  const d = new Directory(pathToUri(ensureGitRoot().replace(/\/git\/?$/, '/trash')));
  d.create({ intermediates: true, idempotent: true });
  return d;
};
const gitDir = (key) => new Directory(pathToUri(`${ensureGitRoot()}/${key}`));

const safeDelete = (item) => {
  try {
    if (item && item.exists) item.delete();
  } catch (e) {}
};

// parts: { files: Directory, history?: Directory }, gitKey, meta (geri yükleme bilgisi). Dönen: kimlik
export function moveToTrash({ name, files, history, gitKey, meta }) {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const box = new Directory(trashRoot(), id);
  box.create({ intermediates: true, idempotent: true });
  // Önce bilgi: taşıma yarıda kalsa bile kutuda ne olduğu bilinsin
  new File(box, 'meta.json').write(JSON.stringify({ id, name, gitKey: gitKey || null, deletedAt: Date.now(), ...meta }));
  if (files && files.exists) files.moveSync(new Directory(box, 'files'));
  if (gitKey) {
    const g = gitDir(gitKey);
    if (g.exists) g.moveSync(new Directory(box, 'git'));
  }
  if (history && history.exists) history.moveSync(new Directory(box, 'history'));
  return id;
}

function readMeta(box) {
  try {
    const f = new File(box, 'meta.json');
    return f.exists ? JSON.parse(f.textSync()) : null;
  } catch (e) {
    return null;
  }
}

// Silinenler (yeniden eskiye); süresi dolanlar burada kalıcı silinir
export function listTrash() {
  const out = [];
  let items = [];
  try {
    items = trashRoot().list();
  } catch (e) {
    return out;
  }
  for (const it of items) {
    if (!(it instanceof Directory)) continue;
    const meta = readMeta(it);
    if (!meta) continue;
    if (Date.now() - (meta.deletedAt || 0) > KEEP_DAYS * DAY) {
      safeDelete(it);
      continue;
    }
    out.push({ ...meta, daysLeft: Math.max(1, Math.ceil((meta.deletedAt + KEEP_DAYS * DAY - Date.now()) / DAY)) });
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

export function purge(id) {
  safeDelete(new Directory(trashRoot(), id));
}

// Kutudaki parçaları yerlerine taşır. target: { files: Directory (henüz yok), history?: Directory }
// Git deposu aynı anahtarla geri döner; o anahtar doluysa yeni anahtar alır. Dönen: { meta, gitKey }
export function takeOut(id, target) {
  const box = new Directory(trashRoot(), id);
  const meta = readMeta(box);
  if (!meta) throw new Error('missing');
  const files = new Directory(box, 'files');
  if (files.exists) files.moveSync(target.files);
  else target.files.create({ intermediates: true, idempotent: true });
  let gitKey = meta.gitKey;
  const g = new Directory(box, 'git');
  if (gitKey && g.exists) {
    if (gitDir(gitKey).exists) gitKey = `${gitKey}-r${Date.now().toString(36)}`;
    g.moveSync(gitDir(gitKey));
  }
  const h = new Directory(box, 'history');
  if (h.exists && target.history && !target.history.exists) h.moveSync(target.history);
  safeDelete(box);
  return { meta, gitKey };
}
