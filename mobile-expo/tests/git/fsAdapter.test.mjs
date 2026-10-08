// Git motorunun depolama katmanı: fsAdapter hata kodları (Node arka ucu ile) ve Library yolu türetme.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { createFs, normPath, dirnameOf } from '../../src/git/fsAdapter.js';
import { libraryGitRootUri, containerUriFromDocuments, uriToPath, pathToUri, projectGitdir } from '../../src/git/paths.js';
import { backendNode } from '../support/backendNode.mjs';

const made = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'drw-fsa-'));
  made.push(d);
  return normPath(d);
};
after(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

const code = async (p) => {
  try {
    await p;
  } catch (e) {
    return e.code;
  }
  return 'OK';
};

test('fsAdapter: Node tarzı hata kodları ve anlamlar', async () => {
  const root = tmp();
  const { promises: f } = createFs(backendNode());

  // Olmayan dosya / klasör
  assert.equal(await code(f.readFile(`${root}/yok.txt`)), 'ENOENT');
  assert.equal(await code(f.stat(`${root}/yok`)), 'ENOENT');
  assert.equal(await code(f.lstat(`${root}/yok`)), 'ENOENT');
  assert.equal(await code(f.readdir(`${root}/yok`)), 'ENOENT');
  assert.equal(await code(f.unlink(`${root}/yok.txt`)), 'ENOENT');
  assert.equal(await code(f.rmdir(`${root}/yok`)), 'ENOENT');
  assert.equal(await code(f.readlink(`${root}/yok`)), 'ENOENT');

  // Üst klasörü olmayan yere yazma → ENOENT; mkdir özyinelemesiz → ENOENT, özyinelemeli → olur
  assert.equal(await code(f.writeFile(`${root}/a/b/c.txt`, 'x')), 'ENOENT');
  assert.equal(await code(f.mkdir(`${root}/a/b`)), 'ENOENT');
  assert.equal(await code(f.mkdir(`${root}/a/b`, { recursive: true })), 'OK');
  assert.equal(await code(f.mkdir(`${root}/a/b`, { recursive: true })), 'OK');
  assert.equal(await code(f.mkdir(`${root}/a/b`)), 'EEXIST');

  // Yaz / oku (metin ve bayt)
  await f.writeFile(`${root}/a/b/c.txt`, 'çalışma ğüş');
  assert.equal(await f.readFile(`${root}/a/b/c.txt`, 'utf8'), 'çalışma ğüş');
  assert.equal(await f.readFile(`${root}/a/b/c.txt`, { encoding: 'utf8' }), 'çalışma ğüş');
  const buf = await f.readFile(`${root}/a/b/c.txt`);
  assert.ok(Buffer.isBuffer(buf));
  assert.equal(buf.toString('utf8'), 'çalışma ğüş');
  await f.writeFile(`${root}/a/bin.dat`, new Uint8Array([0, 1, 2, 255]));
  assert.deepEqual([...(await f.readFile(`${root}/a/bin.dat`))], [0, 1, 2, 255]);

  // Dosyanın altına yazma / dosyayı klasör gibi okuma → ENOTDIR
  assert.equal(await code(f.writeFile(`${root}/a/bin.dat/x`, 'x')), 'ENOTDIR');
  assert.equal(await code(f.readdir(`${root}/a/bin.dat`)), 'ENOTDIR');
  assert.equal(await code(f.rmdir(`${root}/a/bin.dat`)), 'ENOTDIR');
  assert.equal(await code(f.readFile(`${root}/a`)), 'EISDIR');
  assert.equal(await code(f.unlink(`${root}/a`)), 'EPERM');

  // readdir, stat türleri
  assert.deepEqual((await f.readdir(`${root}/a`)).sort(), ['b', 'bin.dat']);
  const sd = await f.stat(`${root}/a`);
  const sf = await f.stat(`${root}/a/bin.dat`);
  assert.equal(sd.isDirectory(), true);
  assert.equal(sd.isFile(), false);
  assert.equal(sf.isFile(), true);
  assert.equal(sf.isSymbolicLink(), false);
  assert.equal(sf.size, 4);
  assert.ok(sf.mtimeMs > 0);

  // Dolu klasör silinmez; boşalınca silinir
  assert.equal(await code(f.rmdir(`${root}/a/b`)), 'ENOTEMPTY');
  await f.unlink(`${root}/a/b/c.txt`);
  assert.equal(await code(f.rmdir(`${root}/a/b`)), 'OK');
  assert.equal(await code(f.stat(`${root}/a/b`)), 'ENOENT');

  // Telefonda sembolik bağ yok
  assert.equal(await code(f.symlink('x', `${root}/l`)), 'ENOSYS');
  assert.equal(await code(f.readlink(`${root}/a/bin.dat`)), 'EINVAL');
});

test('fsAdapter: isomorphic-git ile init / nesne yaz-oku / ref', async () => {
  const root = tmp();
  const fsx = createFs(backendNode());
  const gitdir = `${root}/repo.git`;
  await git.init({ fs: fsx, dir: `${root}/w`, gitdir, defaultBranch: 'main' });
  assert.ok(fs.existsSync(path.join(gitdir, 'HEAD')));
  const oid = await git.writeBlob({ fs: fsx, gitdir, blob: new TextEncoder().encode('merhaba') });
  const { blob } = await git.readBlob({ fs: fsx, gitdir, oid });
  assert.equal(new TextDecoder().decode(blob), 'merhaba');
  const tree = await git.writeTree({ fs: fsx, gitdir, tree: [{ mode: '100644', path: 'a.txt', oid, type: 'blob' }] });
  const a = { name: 'T', email: 't@t', timestamp: 1700000000, timezoneOffset: 0 };
  const c = await git.writeCommit({ fs: fsx, gitdir, commit: { message: 'ilk\n', tree, parent: [], author: a, committer: a } });
  await git.writeRef({ fs: fsx, gitdir, ref: 'refs/heads/main', value: c, force: true });
  assert.equal(await git.resolveRef({ fs: fsx, gitdir, ref: 'main' }), c);
  // Sistem git'i de aynı depoyu okuyabilmeli (gerçek git biçimi)
  const { execFileSync } = await import('node:child_process');
  assert.equal(execFileSync('git', ['--git-dir', gitdir, 'cat-file', '-p', `${c}:a.txt`], { windowsHide: true }).toString(), 'merhaba');
});

test('yol yardımcıları: normPath / dirnameOf', () => {
  assert.equal(normPath('C:\\x\\y\\'), 'C:/x/y');
  assert.equal(normPath('/a//b/'), '/a/b');
  assert.equal(dirnameOf('/a/b'), '/a');
  assert.equal(dirnameOf('/a'), '/');
  assert.equal(dirnameOf('C:/a'), 'C:/');
});

test('Library yolu: Belgeler adresinden git kökü türetilir (Dosyalar uygulamasında görünmez)', () => {
  const docs = 'file:///var/mobile/Containers/Data/Application/AB12-CD34/Documents/';
  const want = 'file:///var/mobile/Containers/Data/Application/AB12-CD34/Library/Application%20Support/DraftRewind/git/';
  assert.equal(libraryGitRootUri(docs), want);
  // Sonda "/" olmadan da aynı
  assert.equal(libraryGitRootUri(docs.slice(0, -1)), want);
  assert.equal(containerUriFromDocuments(docs), 'file:///var/mobile/Containers/Data/Application/AB12-CD34/');
  // Yüzde kodlaması korunur, iki kez kodlanmaz
  const sim = 'file:///Users/John%20Doe/Library/Developer/CoreSimulator/Devices/X/data/Containers/Data/Application/Y/Documents/';
  const simRoot = libraryGitRootUri(sim);
  assert.equal(simRoot, 'file:///Users/John%20Doe/Library/Developer/CoreSimulator/Devices/X/data/Containers/Data/Application/Y/Library/Application%20Support/DraftRewind/git/');
  assert.ok(!simRoot.includes('%2520'));
  assert.equal(uriToPath(simRoot), '/Users/John Doe/Library/Developer/CoreSimulator/Devices/X/data/Containers/Data/Application/Y/Library/Application Support/DraftRewind/git');
  // Belgeler ile bitmeyen adres reddedilir (git verisi yanlış yere yazılmasın)
  for (const bad of ['file:///var/x/Library/', 'file:///var/x/DocumentsX/', '/var/x/Documents/', '', null]) {
    assert.throws(() => libraryGitRootUri(bad), (e) => e.code === 'EBADDOC');
  }
  // Düz yol ↔ adres (Türkçe karakter ve boşluk)
  const p = '/var/mobile/Documents/Projeler/Tez Çalışması/Bölüm 1.docx';
  assert.equal(pathToUri(p), 'file:///var/mobile/Documents/Projeler/Tez%20%C3%87al%C4%B1%C5%9Fmas%C4%B1/B%C3%B6l%C3%BCm%201.docx');
  assert.equal(uriToPath(pathToUri(p)), p);
  assert.equal(projectGitdir(docs, 'ab/c d'), '/var/mobile/Containers/Data/Application/AB12-CD34/Library/Application Support/DraftRewind/git/ab_c_d');
});
