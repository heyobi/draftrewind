// GitHub erişimi: masaüstü DraftRewind uygulamasının yedeklediği depoları okur.
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import * as Legacy from 'expo-file-system/legacy';
import { t } from './i18n';
import { buildTreeEntries, buildMessage, slugify, toBase64, utf8Encode } from './wsCore';

// Masaüstü uygulamasıyla aynı OAuth uygulaması (device flow açık olmalı).
export const GITHUB_CLIENT_ID = 'Ov23liD2VS140X5UplHW';
const API = 'https://api.github.com';
const TOKEN_KEY = 'acadamiv_github_token';

// Oturum iki yerde saklanır: iOS anahtar zinciri ve uygulamanın kendi klasörü.
// Yan yüklenen (Sideloadly/AltStore) uygulamalarda anahtar zinciri bazen okunamıyor;
// bu durumda dosyadaki kopya kullanılır ve kullanıcı her açılışta giriş yapmak zorunda kalmaz.
// Dosya önbellek klasöründe durur (iCloud/iTunes yedeğine girmez). Eski sürümler Belgeler klasörüne
// yazıyordu; ilk açılışta oradaki kopya taşınır ve silinir.
const tokenFile = () => new File(Paths.cache, 'oturum.txt');
const legacyTokenFile = () => new File(Paths.document, 'oturum.txt');

export function migrateSecretFile(legacy, next) {
  try {
    if (!legacy.exists) return;
    try {
      if (!next.exists) next.write(legacy.textSync());
    } catch (e) {}
    legacy.delete();
  } catch (e) {}
}

export async function loadToken() {
  migrateSecretFile(legacyTokenFile(), tokenFile());
  try {
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    if (t) return t;
  } catch (e) {}
  try {
    const f = tokenFile();
    if (f.exists) return (await f.text()).trim() || null;
  } catch (e) {}
  return null;
}

export async function saveToken(token) {
  migrateSecretFile(legacyTokenFile(), tokenFile());
  // Dosya kopyası yalnızca anahtar zinciri çalışmadığında yazılır; çalışıyorsa eski kopya silinir
  let stored = false;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    stored = true;
  } catch (e) {}
  try {
    const f = tokenFile();
    if (token && !stored) f.write(token);
    else if (f.exists) f.delete();
  } catch (e) {}
}

export async function startDeviceFlow() {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'repo read:user' }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);
  return data;
}

export async function pollToken(flow, isCancelled) {
  let interval = (flow.interval || 5) * 1000;
  const deadline = Date.now() + (flow.expires_in || 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    if (isCancelled()) throw new Error(t('err.cancelled'));
    let data;
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: flow.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      data = await res.json();
    } catch (e) {
      continue;
    }
    if (data.access_token) return data.access_token;
    if (data.error === 'slow_down') interval += 5000;
    else if (data.error === 'authorization_pending') continue;
    else if (data.error === 'access_denied') throw new Error(t('err.denied'));
    else if (data.error) throw new Error(data.error_description || data.error);
  }
  throw new Error(t('err.codeExpired'));
}

async function api(token, path, { raw } = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    },
  });
  if (res.status === 401) {
    const e = new Error(t('err.sessionExpired'));
    e.auth = true;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(t('err.github', { status: res.status }));
    e.status = res.status;
    throw e;
  }
  return raw ? res.arrayBuffer() : res.json();
}

export async function getUser(token) {
  const u = await api(token, '/user');
  return { login: u.login, name: u.name || u.login, avatar: u.avatar_url };
}

export async function listProjects(token) {
  const repos = await api(token, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator');
  return repos
    // Sadece masaüstü uygulamasının oluşturduğu yedek depoları (etiket veya açıklama ile işaretli)
    .filter((r) => (r.topics || []).some((t) => t === 'draftrewind' || t === 'acadamiv') || /(DraftRewind|AcadamiV) ile otomatik yedeklenir/.test(r.description || ''))
    .map((r) => ({
      owner: r.owner.login,
      repo: r.name,
      name: (r.description || '').split(' — ')[0] || r.name.replace(/^(draftrewind|acadamiv)-/, ''),
      pushedAt: new Date(r.pushed_at).getTime(),
      private: r.private,
      branch: r.default_branch || 'main',
    }));
}

const TRAILER = '\n\nacadamiv:';
export function parseMessage(message) {
  const idx = message.indexOf(TRAILER);
  let meta = {};
  let body = message;
  if (idx >= 0) {
    body = message.slice(0, idx);
    try {
      meta = JSON.parse(message.slice(idx + TRAILER.length).trim());
    } catch (e) {}
  }
  const [title, ...rest] = body.split('\n');
  // Eski sürümlerin başlıklarındaki emojiler (ör. telefon simgeli "Telefondan eklendi") gösterilmez
  const clean = title.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s{2,}/g, ' ').trim();
  return { title: clean, note: rest.join('\n').trim(), meta };
}

// since (epoch ms, isteğe bağlı): yalnızca bu andan sonraki kayıtlar (istatistikler için daha çok sayfa çekilebilir)
export async function listSnapshots(token, p, pages = 3, since) {
  const out = [];
  const sinceQ = since ? `&since=${encodeURIComponent(new Date(since).toISOString())}` : '';
  for (let page = 1; page <= pages; page++) {
    const list = await api(token, `/repos/${p.owner}/${p.repo}/commits?sha=${p.branch}&per_page=100&page=${page}${sinceQ}`);
    for (const c of list) {
      const { title, note, meta } = parseMessage(c.commit.message);
      out.push({
        oid: c.sha,
        title,
        note,
        kind: meta.kind || 'auto',
        time: new Date(c.commit.committer.date).getTime(),
        total: meta.total,
        delta: meta.delta || {},
        changed: meta.changed || [],
        deleted: meta.deleted || [],
        words: meta.words || null,
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export async function listFiles(token, p, ref) {
  const t = await api(token, `/repos/${p.owner}/${p.repo}/git/trees/${ref || p.branch}?recursive=1`);
  return t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size, sha: e.sha }));
}

// Dalın uç kaydı (sha). Boş depoda (hiç kayıt yok) null döner.
export async function branchHead(token, p) {
  const res = await fetch(`${API}/repos/${p.owner}/${p.repo}/git/ref/heads/${encodeURIComponent(p.branch)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw await failure(res);
  const ref = await res.json();
  return ref.object ? ref.object.sha : null;
}

export async function commitFiles(token, p, oid) {
  const c = await api(token, `/repos/${p.owner}/${p.repo}/commits/${oid}`);
  return {
    parent: c.parents && c.parents[0] ? c.parents[0].sha : null,
    files: (c.files || []).map((f) => ({ path: f.filename, status: f.status })),
  };
}

export async function fileContent(token, p, path, ref) {
  return api(token, `/repos/${p.owner}/${p.repo}/contents/${encPath(path)}?ref=${ref || p.branch}`, { raw: true });
}

const encPath = (path) => path.split('/').map(encodeURIComponent).join('/');

// Dosya bu dalda var mı? (ad çakışmasını önlemek için)
export async function pathExists(token, p, path) {
  const res = await fetch(`${API}/repos/${p.owner}/${p.repo}/contents/${encPath(path)}?ref=${p.branch}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (res.status === 404) return false;
  if (res.status === 401) {
    const e = new Error(t('err.sessionExpired'));
    e.auth = true;
    throw e;
  }
  if (!res.ok) throw new Error(t('err.github', { status: res.status }));
  return true;
}

// GitHub'ın kendi hata metnini okunur bir hataya çevirir (yalnızca "403" demek yetmiyor)
async function failure(res) {
  if (res.status === 401) {
    const e = new Error(t('err.sessionExpired'));
    e.auth = true;
    return e;
  }
  let msg = '';
  try {
    msg = String((await res.json()).message || '');
  } catch (e) {}
  if (res.status === 413 || /too large|exceeds|size/i.test(msg)) return new Error(t('err.githubTooLarge'));
  if ((res.status === 403 || res.status === 429) && (/rate limit/i.test(msg) || res.headers.get('x-ratelimit-remaining') === '0')) return new Error(t('err.githubRateLimit'));
  const e = new Error(msg ? `${t('err.github', { status: res.status })}: ${msg}` : t('err.github', { status: res.status }));
  e.status = res.status;
  return e;
}

async function send(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Büyük blob gövdesi (onlarca MB base64 JSON) fetch ile bellekten gönderilince iOS bağlantıyı
// düşürebiliyor ("The network connection was lost"). Gövde önce diske yazılır, oradan arka plan
// oturumuyla akıtılarak yüklenir (uygulama arka plana geçse de sürer) ve ağ hatasında yeniden denenir.
async function postBlob(token, path, base64) {
  const tmp = new File(Paths.cache, `blob-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.write(`{"encoding":"base64","content":"${base64}"}`);
  try {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await Legacy.uploadAsync(API + path, tmp.uri, {
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          uploadType: Legacy.FileSystemUploadType.BINARY_CONTENT,
          sessionType: Legacy.FileSystemSessionType.BACKGROUND,
        });
        if (r.status >= 200 && r.status < 300) return JSON.parse(r.body || '{}');
        // Sunucu yanıtı var: GitHub'ın kendi mesajıyla hataya çevir (yeniden denemek anlamsız)
        const pseudo = {
          status: r.status,
          json: async () => JSON.parse(r.body || '{}'),
          headers: { get: (k) => (r.headers ? r.headers[k] || r.headers[k.toLowerCase()] || null : null) },
        };
        throw await failure(pseudo);
      } catch (e) {
        lastErr = e;
        if (e.auth || e.status) throw e; // sunucu reddetti: tekrar denenmez
        if (attempt < 2) await sleep(2000 * (attempt + 1)); // ağ koptu: biraz bekle, yeniden dene
      }
    }
    // Üç denemede de ağ koptu: teknik iz yerine anlaşılır mesaj
    const e = new Error(t('err.uploadNetwork'));
    e.cause = lastErr;
    throw e;
  } finally {
    try {
      if (tmp.exists) tmp.delete();
    } catch (e) {}
  }
}

// Telefondan dosya ekleme. "contents" API'si büyük dosyaları (ör. video) 403 ile reddediyor;
// bu yüzden Git veri API'si kullanılır: her dosya ayrı bir blob (100 MB'a kadar), hepsi TEK kayıtta.
// files: [{ path, read: async () => base64 }] — içerik sırayla okunur, bellekte hep tek dosya durur.
// onProgress(i): i. dosya yüklenmeye başladı. Dönen: { done: [path], failed: [{ path, error }] }
export async function addFiles(token, p, files, makeMessage, onProgress) {
  const r = await commitChanges(token, p, files, [], (paths) => makeMessage(paths), onProgress);
  return { done: r.done.map((d) => d.path), failed: r.failed };
}

// Genel kayıt: yeni/değişen dosyalar (bloblar) + silinen yollar, hepsi TEK kayıtta.
// files: [{ path, read: async () => base64 }], removals: [path]
// makeMessage(uploadedPaths, removedPaths) → kayıt mesajı. onProgress(i): i. dosya yüklenmeye başladı.
// Dönen: { done: [{ path, sha }], removed: [path], failed: [{ path, error }], commit: sha | null }
export async function commitChanges(token, p, files, removals, makeMessage, onProgress) {
  const base = `/repos/${p.owner}/${p.repo}`;
  const blobs = [];
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    if (onProgress) onProgress(i);
    try {
      const content = await files[i].read();
      const blob = await postBlob(token, `${base}/git/blobs`, content);
      blobs.push({ path: files[i].path, sha: blob.sha });
    } catch (e) {
      if (e.auth) throw e;
      failed.push({ path: files[i].path, error: e });
    }
  }
  const wanted = [...new Set(removals || [])];
  if (!blobs.length && !wanted.length) return { done: [], removed: [], failed, commit: null };
  // Masaüstü aynı anda kayıt gönderirse dal ilerlemiş olabilir: güncel uçtan yeniden dene
  for (let attempt = 0; ; attempt++) {
    const ref = await send(token, 'GET', `${base}/git/ref/heads/${encodeURIComponent(p.branch)}`);
    const head = ref.object.sha;
    const commit = await send(token, 'GET', `${base}/git/commits/${head}`);
    // Ağaçta olmayan bir yolu silmeye çalışmak 422 verir: silinecekler güncel ağaca göre süzülür
    let removed = [];
    if (wanted.length) {
      const current = await send(token, 'GET', `${base}/git/trees/${commit.tree.sha}?recursive=1`);
      const present = new Set((current.tree || []).filter((e) => e.type === 'blob').map((e) => e.path));
      removed = wanted.filter((path) => present.has(path));
    }
    const entries = buildTreeEntries(blobs, removed);
    if (!entries.length) return { done: [], removed: [], failed, commit: null };
    const message = makeMessage(blobs.map((b) => b.path), removed);
    const tree = await send(token, 'POST', `${base}/git/trees`, { base_tree: commit.tree.sha, tree: entries });
    const next = await send(token, 'POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [head] });
    try {
      await send(token, 'PATCH', `${base}/git/refs/heads/${encodeURIComponent(p.branch)}`, { sha: next.sha, force: false });
      return { done: blobs, removed, failed, commit: next.sha };
    } catch (e) {
      if (e.status !== 422 || attempt >= 2) throw e;
    }
  }
}

// Telefondan yeni proje: masaüstünün ensureRepo'suyla birebir aynı depo (gizli, açıklama, etiketler).
// Ad alınmışsa -2, -3… denenir. İlk kayıt olarak küçük bir README.txt konur ki dal var olsun.
// readme: dosya içeriği (dile göre). Dönen: listProjects ile aynı biçimde proje nesnesi.
export async function createProject(token, name, readme) {
  const base = `draftrewind-${slugify(name)}`;
  let repo = null;
  for (let i = 0; i < 20 && !repo; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    try {
      repo = await send(token, 'POST', '/user/repos', {
        name: candidate,
        private: true,
        auto_init: false,
        description: `${name} — DraftRewind ile otomatik yedeklenir`,
      });
    } catch (e) {
      if (e.status !== 422) throw e;
    }
  }
  if (!repo) throw new Error(t('home.newProjectNameTaken'));
  const full = repo.full_name;
  await send(token, 'PUT', `/repos/${full}/topics`, { names: ['draftrewind', 'acadamiv'] });
  // İlk kayıt: içerik API'si boş depoda da çalışır ve "main" dalını oluşturur
  const message = buildMessage({ title: t('home.newProjectCommit'), changed: ['README.txt'], deleted: [] });
  await send(token, 'PUT', `/repos/${full}/contents/README.txt`, { message, content: toBase64(utf8Encode(readme)), branch: 'main' });
  try {
    if (repo.default_branch !== 'main') await send(token, 'PATCH', `/repos/${full}`, { default_branch: 'main' });
  } catch (e) {}
  return { owner: repo.owner.login, repo: repo.name, name, pushedAt: Date.now(), private: true, branch: 'main' };
}
