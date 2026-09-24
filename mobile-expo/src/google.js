// Google ile giriş + Drive'daki DraftRewind klasörlerini okuma.
// iOS için Google Cloud'da "iOS" türünde istemci gerekir (paket kimliği: com.draftrewind.app).
// Masaüstündeki "Desktop app" istemcisiyle aynı projede olmalı ki masaüstünün yüklediği dosyalar görünsün.
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import { t as translate } from './i18n';

export const GOOGLE_IOS_CLIENT_ID = '506965274607-chr5jkmhrpkjo1dtp854tg2oirbs80dk.apps.googleusercontent.com';

const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const KEY = 'draftrewind_google_tokens';
const ROOT_FOLDERS = ['DraftRewind', 'AcadamiV'];

export const googleAvailable = () => !!GOOGLE_IOS_CLIENT_ID;

function redirectUri() {
  const id = GOOGLE_IOS_CLIENT_ID.replace('.apps.googleusercontent.com', '');
  return `com.googleusercontent.apps.${id}:/oauth2redirect`;
}

const b64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function randomString(bytes = 32) {
  const arr = Crypto.getRandomBytes(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return b64url(btoa(s));
}

// ---------------------------------------------------------------- jeton saklama
const tokenFile = () => new File(Paths.document, 'google-oturum.json');

export async function loadGoogle() {
  let raw = null;
  try {
    raw = await SecureStore.getItemAsync(KEY);
  } catch (e) {}
  if (!raw) {
    try {
      const f = tokenFile();
      if (f.exists) raw = await f.text();
    } catch (e) {}
  }
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export async function saveGoogle(session) {
  const raw = session ? JSON.stringify(session) : null;
  try {
    if (raw) await SecureStore.setItemAsync(KEY, raw);
    else await SecureStore.deleteItemAsync(KEY);
  } catch (e) {}
  try {
    const f = tokenFile();
    if (raw) f.write(raw);
    else if (f.exists) f.delete();
  } catch (e) {}
}

// ---------------------------------------------------------------- giriş
export async function signIn() {
  if (!googleAvailable()) throw new Error(translate('err.googleNotSet'));
  const verifier = randomString(48);
  const challenge = b64url(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 }));
  const state = randomString(12);
  const params = {
    client_id: GOOGLE_IOS_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'consent',
    access_type: 'offline',
  };
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const res = await WebBrowser.openAuthSessionAsync(url, redirectUri());
  if (res.type !== 'success') throw new Error(translate('err.googleCancelled'));
  const q = {};
  (res.url.split('?')[1] || '').split('&').forEach((p) => {
    const [k, v] = p.split('=');
    if (k) q[k] = decodeURIComponent(v || '');
  });
  if (q.state !== state || !q.code) throw new Error(q.error || translate('err.googleIncomplete'));
  const tr = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `code=${encodeURIComponent(q.code)}&client_id=${encodeURIComponent(GOOGLE_IOS_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri())}&grant_type=authorization_code&code_verifier=${verifier}`,
  });
  const t = await tr.json();
  if (!t.access_token) throw new Error(t.error_description || t.error || translate('err.googleToken'));
  const ur = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
  const u = ur.ok ? await ur.json() : {};
  const session = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in || 3600) * 1000,
    user: { name: u.name || u.email, email: u.email, picture: u.picture },
  };
  await saveGoogle(session);
  return session;
}

// ---------------------------------------------------------------- Drive
export class Drive {
  constructor(session, onSession) {
    this.session = session;
    this.onSession = onSession;
  }

  async token() {
    const s = this.session;
    if (s.access_token && Date.now() < s.expires_at - 60000) return s.access_token;
    if (!s.refresh_token) return s.access_token;
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `client_id=${encodeURIComponent(GOOGLE_IOS_CLIENT_ID)}&refresh_token=${encodeURIComponent(s.refresh_token)}&grant_type=refresh_token`,
    });
    const d = await r.json();
    if (!d.access_token) {
      const e = new Error(translate('err.googleExpired'));
      e.auth = true;
      throw e;
    }
    this.session = { ...s, access_token: d.access_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000 };
    await saveGoogle(this.session);
    this.onSession && this.onSession(this.session);
    return this.session.access_token;
  }

  async get(url, raw) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (r.status === 401) {
      const e = new Error(translate('err.googleExpired'));
      e.auth = true;
      throw e;
    }
    if (!r.ok) throw new Error(translate('err.drive', { status: r.status }));
    return raw ? r.arrayBuffer() : r.json();
  }

  async children(parentId, foldersOnly) {
    const q = [`'${parentId}' in parents`, 'trashed=false'];
    if (foldersOnly) q.push("mimeType='application/vnd.google-apps.folder'");
    const url = `https://www.googleapis.com/drive/v3/files?pageSize=500&orderBy=folder,name&fields=files(id,name,mimeType,modifiedTime,size)&q=${encodeURIComponent(q.join(' and '))}`;
    const d = await this.get(url);
    return d.files.map((f) => ({
      id: f.id,
      name: f.name,
      folder: f.mimeType === 'application/vnd.google-apps.folder',
      modified: new Date(f.modifiedTime).getTime(),
      size: Number(f.size || 0),
    }));
  }

  // DraftRewind/<Proje> klasörleri
  async projects() {
    const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and 'root' in parents and (${ROOT_FOLDERS.map((n) => `name='${n}'`).join(' or ')})`;
    const roots = await this.get(`https://www.googleapis.com/drive/v3/files?fields=files(id,name)&q=${encodeURIComponent(q)}`);
    const out = [];
    for (const r of roots.files) {
      for (const f of await this.children(r.id, true)) out.push(f);
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  download(id) {
    return this.get(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, true);
  }
}
