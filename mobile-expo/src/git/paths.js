// Git verisinin telefondaki yeri ve file:// adresi ↔ düz yol dönüşümleri (saf; Node'da test edilir).
//
// Git verisi Belgeler (Documents) altında DURMAMALI: UIFileSharingEnabled açık olduğu için Belgeler
// Dosyalar uygulamasında görünür; öğrenci .git içini görüp silebilir. expo-file-system'de Paths.library yok;
// Belgeler adresinin sonundaki "/Documents/" kısmı "/Library/Application Support/DraftRewind/git/" ile
// değiştirilir (aynı uygulama kapsayıcısı, Dosyalar'da görünmez, iCloud yedeğine girer).

export const GIT_ROOT_SEGMENTS = ['Library', 'Application Support', 'DraftRewind', 'git'];

const encodeSeg = (s) => encodeURIComponent(s);
const decodeSeg = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
};

// "file:///…/<UUID>/Documents/" → "file:///…/<UUID>/" (kapsayıcı kökü). Belgeler değilse hata.
export function containerUriFromDocuments(documentUri) {
  const s = String(documentUri || '');
  const m = s.match(/^(.*\/)Documents\/?$/);
  if (!m || !/^file:\/\//i.test(s)) {
    const e = new Error(`Belgeler klasörü adresi tanınmadı: ${s}`);
    e.code = 'EBADDOC';
    throw e;
  }
  return m[1];
}

// Git kök klasörünün adresi (sonda "/"): <kapsayıcı>/Library/Application%20Support/DraftRewind/git/
// Kapsayıcı kısmındaki yüzde kodlaması aynen korunur (iki kez kodlanmaz).
export function libraryGitRootUri(documentUri) {
  return `${containerUriFromDocuments(documentUri)}${GIT_ROOT_SEGMENTS.map(encodeSeg).join('/')}/`;
}

// "file:///a/b%20c/" → "/a/b c"
export function uriToPath(uri) {
  let s = String(uri);
  s = s.replace(/^file:\/\//i, '');
  const parts = s.split('/').map(decodeSeg);
  let p = parts.join('/');
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

// "/a/b c" → "file:///a/b%20c"
export function pathToUri(path) {
  const s = String(path).replace(/\\/g, '/');
  const parts = s.split('/').map((x, i) => (i === 0 ? x : encodeSeg(x)));
  return `file://${parts.join('/')}`;
}

// Projenin git klasörü: <git kökü>/<proje kimliği> (düz yol)
export function projectGitdir(documentUri, projectId) {
  const safe = String(projectId).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${uriToPath(libraryGitRootUri(documentUri))}/${safe}`;
}
