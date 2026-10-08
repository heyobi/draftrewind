// Senkron motoru öz-testi (Ayarlar › Gelişmiş). Gerçek telefonda, Hermes üzerinde git motorunun
// çalıştığını ve hızını ölçer. Kullanıcının projelerine DOKUNMAZ: her şey geçici klasörlerde olur
// ve sonunda silinir. GitHub testi yalnızca okur (boş bir depoya çeker; hiçbir şey göndermez).
import { Directory, File, Paths } from 'expo-file-system';
import JSZip from 'jszip';
import './polyfill.js';
import { openProject, gitEngineVersion } from './engine.js';
import { backendExpo, ensureGitRoot } from './backendExpo.js';
import { uriToPath, pathToUri } from './paths.js';

const now = () => Date.now();

function wipe(path) {
  try {
    const d = new Directory(pathToUri(path));
    if (d.exists) d.delete();
  } catch (e) {}
}

function writeText(path, text) {
  const f = new File(pathToUri(path));
  if (!f.parentDirectory.exists) f.parentDirectory.create({ intermediates: true, idempotent: true });
  f.write(text);
}

async function tinyDocx(paragraphs) {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

function dirSize(path) {
  let total = 0;
  const walk = (d) => {
    for (const e of d.list()) {
      if (e instanceof Directory) walk(e);
      else total += e.size || 0;
    }
  };
  try {
    walk(new Directory(pathToUri(path)));
  } catch (e) {}
  return total;
}

// github: { owner, repo, token } (isteğe bağlı). onStep(text): ilerleme. Dönen: rapor metni.
export async function runSelfTest({ github, onStep } = {}) {
  const lines = [`DraftRewind motor testi · ${gitEngineVersion} · ${new Date().toISOString()}`];
  const step = async (name, fn) => {
    if (onStep) onStep(name);
    const t0 = now();
    try {
      const info = await fn();
      lines.push(`OK   ${name} (${now() - t0} ms)${info ? ` — ${info}` : ''}`);
      return true;
    } catch (e) {
      lines.push(`HATA ${name} (${now() - t0} ms) — ${e && e.message ? e.message : String(e)}`);
      return false;
    }
  };

  const backend = backendExpo();
  const root = ensureGitRoot();
  const base = `${root}/_selftest`;
  const work = `${uriToPath(Paths.cache.uri)}/dr-selftest-work`;
  wipe(base);
  wipe(work);
  let p = null;
  let first = null;

  await step('Klasörler', async () => `git: ${base}`);
  await step('Türkçe adlı dosyalar yazma', async () => {
    writeText(`${work}/Bölüm 1 – Giriş.txt`, 'Bu çalışmada kentsel ısı adası incelenmiştir.');
    writeText(`${work}/notlar/Çalışma planı.md`, '# Plan\nİlk hafta literatür.');
    const docx = await tinyDocx(['Yöntem bölümü.', 'Veriler Landsat 8 uydusundan alınmıştır.']);
    new File(pathToUri(`${work}/Tez.docx`)).write(docx);
    // NFD (ayrışık) ad: Dosyalar uygulaması bazen böyle yazar
    writeText(`${work}/${'Özet'.normalize('NFD')}.txt`, 'özet');
    return '4 dosya';
  });
  await step('Projeyi aç (git init)', async () => {
    p = await openProject({ backend, gitdir: `${base}/repo`, dir: work, id: 'selftest', name: 'Selftest' });
  });
  if (p) {
    await step('İlk kayıt', async () => {
      first = await p.snapshot({ kind: 'auto' });
      if (!first) throw new Error('kayıt oluşmadı');
      return `${first.changed.length} dosya, ${first.total} kelime`;
    });
    await step('Düzenle + ikinci kayıt', async () => {
      writeText(`${work}/Bölüm 1 – Giriş.txt`, 'Bu çalışmada kentsel ısı adası etkisi uydu verisiyle ayrıntılı incelenmiştir.');
      const r = await p.snapshot({ kind: 'auto' });
      if (!r) throw new Error('değişiklik görülmedi');
      return `${r.title} (+${Object.values(r.delta || {}).reduce((a, b) => a + b, 0)})`;
    });
    await step('Değişiklik yokken kayıt alınmaz', async () => {
      const r = await p.snapshot({ kind: 'auto' });
      if (r) throw new Error('gereksiz kayıt: ' + r.title);
      return 'doğru';
    });
    await step('Geçmiş ve eski sürümü okuma', async () => {
      const h = await p.history({ limit: 10 });
      const old = await p.readAt(first.oid, 'Bölüm 1 – Giriş.txt');
      const txt = old ? new TextDecoder().decode(old) : '';
      if (!txt.startsWith('Bu çalışmada kentsel ısı adası incelenmiştir')) throw new Error('eski sürüm yanlış: ' + txt.slice(0, 40));
      return `${h.length} kayıt`;
    });
    await step('Büyük dosya (5 MB) kaydı', async () => {
      const big = new Uint8Array(5 * 1024 * 1024);
      for (let i = 0; i < big.length; i += 4096) big[i] = (i * 31) & 255;
      new File(pathToUri(`${work}/veri.bin`)).write(big);
      const t0 = now();
      const r = await p.snapshot({ kind: 'auto' });
      if (!r) throw new Error('büyük dosya kaydedilmedi');
      return `${now() - t0} ms`;
    });
    await step('Depo boyutu', async () => `${Math.round(dirSize(`${base}/repo`) / 1024)} KB`);
  }

  if (github && github.token && github.owner && github.repo) {
    const cloneWork = `${uriToPath(Paths.cache.uri)}/dr-selftest-clone`;
    wipe(cloneWork);
    await step(`GitHub'dan çekme (${github.repo}, yalnızca okuma)`, async () => {
      const q = await openProject({ backend, gitdir: `${base}/clone`, dir: cloneWork, id: 'selftest-clone', name: 'Clone' });
      const r = await q.sync({ remoteUrl: `https://github.com/${github.owner}/${github.repo}.git`, token: github.token });
      if (r.pushed) throw new Error('beklenmeyen gönderim');
      const h = await q.history({ limit: 500 });
      return `${r.pulled} dosya, ${h.length} kayıt, depo ${Math.round(dirSize(`${base}/clone`) / 1024)} KB`;
    });
    wipe(cloneWork);
  } else {
    lines.push('ATLA GitHub çekme testi (GitHub bağlı değil)');
  }

  wipe(base);
  wipe(work);
  lines.push(lines.some((l) => l.startsWith('HATA')) ? 'SONUÇ: hata var' : 'SONUÇ: hepsi tamam');
  return lines.join('\n');
}
