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
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (e) {}
  try {
    const f = tokenFile();
    if (token) f.write(token);
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
  if (!res.ok) throw new Error(t('err.github', { status: res.status }));
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
  return { title: title.trim(), note: rest.join('\n').trim(), meta };
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

// Telefondan dosya ekleme: tek bir kayıt (commit) olarak depoya yazar. content: base64.
export async function uploadFile(token, p, path, content, message) {
  const res = await fetch(`${API}/repos/${p.owner}/${p.repo}/contents/${encPath(path)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content, branch: p.branch }),
  });
  if (res.status === 401) {
    const e = new Error(t('err.sessionExpired'));
    e.auth = true;
    throw e;
  }
  if (!res.ok) throw new Error(t('err.github', { status: res.status }));
  return res.json();
}
