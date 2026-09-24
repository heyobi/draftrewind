// GitHub erişimi: masaüstü DraftRewind uygulamasının yedeklediği depoları okur.
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { t } from './i18n';

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
  return t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, size: e.size }));
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

// Telefondan dosya ekleme. "contents" API'si büyük dosyaları (ör. video) 403 ile reddediyor;
// bu yüzden Git veri API'si kullanılır: her dosya ayrı bir blob (100 MB'a kadar), hepsi TEK kayıtta.
// files: [{ path, read: async () => base64 }] — içerik sırayla okunur, bellekte hep tek dosya durur.
// onProgress(i): i. dosya yüklenmeye başladı. Dönen: { done: [path], failed: [{ path, error }] }
export async function addFiles(token, p, files, makeMessage, onProgress) {
  const base = `/repos/${p.owner}/${p.repo}`;
  const blobs = [];
  const failed = [];
  for (let i = 0; i < files.length; i++) {
    if (onProgress) onProgress(i);
    try {
      const content = await files[i].read();
      const blob = await send(token, 'POST', `${base}/git/blobs`, { content, encoding: 'base64' });
      blobs.push({ path: files[i].path, mode: '100644', type: 'blob', sha: blob.sha });
    } catch (e) {
      if (e.auth) throw e;
      failed.push({ path: files[i].path, error: e });
    }
  }
  if (!blobs.length) return { done: [], failed };
  const message = makeMessage(blobs.map((b) => b.path));
  // Masaüstü aynı anda kayıt gönderirse dal ilerlemiş olabilir: güncel uçtan yeniden dene
  for (let attempt = 0; ; attempt++) {
    const ref = await send(token, 'GET', `${base}/git/ref/heads/${encodeURIComponent(p.branch)}`);
    const head = ref.object.sha;
    const commit = await send(token, 'GET', `${base}/git/commits/${head}`);
    const tree = await send(token, 'POST', `${base}/git/trees`, { base_tree: commit.tree.sha, tree: blobs });
    const next = await send(token, 'POST', `${base}/git/commits`, { message, tree: tree.sha, parents: [head] });
    try {
      await send(token, 'PATCH', `${base}/git/refs/heads/${encodeURIComponent(p.branch)}`, { sha: next.sha, force: false });
      return { done: blobs.map((b) => b.path), failed };
    } catch (e) {
      if (e.status !== 422 || attempt >= 2) throw e;
    }
  }
}
