const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');
const h = require('./helpers');
const config = require('../app/core/config');
const { Project, parseMessage, BRANCH } = require('../app/core/engine');

after(h.cleanup);

test('kayıt noktası: ilk kayıt, değişiklik yokken kayıt yok, kelime sayısı', async () => {
    const p = await h.openProject();
    h.write(path.join(p.dir, 'notlar.txt'), 'bir iki üç');
    const s1 = await p.snapshot();
    assert.ok(s1 && s1.oid);
    assert.equal(s1.total, 3);
    assert.deepEqual(s1.changed, ['notlar.txt']);

    // Değişiklik yok → null
    assert.equal(await p.snapshot(), null);

    h.write(path.join(p.dir, 'notlar.txt'), 'bir iki üç dört beş');
    const s2 = await p.snapshot();
    assert.equal(s2.total, 5);
    assert.equal(s2.delta['notlar.txt'], 2);

    const hist = await p.history();
    assert.equal(hist.length, 2);
    assert.equal(hist[0].oid, s2.oid);
    assert.equal(hist[1].oid, s1.oid);
});

test('fark (diff): eklenen ve değişen paragraflar', async () => {
    const p = await h.openProject();
    const rel = 'tez.docx';
    h.write(path.join(p.dir, rel), await h.makeDocx(['Giriş paragrafı burada.', 'İkinci paragraf.']));
    const a = await p.snapshot();
    h.write(path.join(p.dir, rel), await h.makeDocx(['Giriş paragrafı tam burada.', 'İkinci paragraf.', 'Yepyeni üçüncü paragraf.']));
    const b = await p.snapshot();
    assert.equal(await p.parentOf(b.oid), a.oid);

    const d = await p.diff(rel, a.oid, b.oid);
    assert.equal(d.supported, true);
    assert.equal(d.kind, 'word');
    const types = d.blocks.map(x => x.type);
    assert.ok(types.includes('mod'), 'değişen paragraf');
    assert.ok(types.includes('add'), 'eklenen paragraf');
    assert.ok(d.added >= 4);
    const add = d.blocks.find(x => x.type === 'add');
    assert.equal(add.text, 'Yepyeni üçüncü paragraf.');

    // Çalışma klasöründeki kaydedilmemiş değişiklik
    h.write(path.join(p.dir, rel), await h.makeDocx(['Giriş paragrafı tam burada.']));
    const w = await p.diff(rel, b.oid, 'working');
    assert.ok(w.blocks.some(x => x.type === 'del'));
    const changes = await p.workingChanges();
    assert.deepEqual(changes.map(c => [c.rel, c.change]), [[rel, 'modified']]);
});

test('geri yükleme: eski sürüm geri gelir, önceki hal de kayıtlı kalır', async () => {
    const p = await h.openProject();
    const file = path.join(p.dir, 'bolum.txt');
    h.write(file, 'ilk hali');
    const first = await p.snapshot();
    h.write(file, 'ikinci hali, daha uzun');
    await p.snapshot();
    h.write(file, 'kaydedilmiş ama kayıt noktası olmayan hal');

    // Kopya olarak geri yükleme asıl dosyaya dokunmaz
    const copy = await p.restore('bolum.txt', first.oid, 'copy');
    assert.equal(fs.readFileSync(copy.path, 'utf8'), 'ilk hali');
    assert.equal(fs.readFileSync(file, 'utf8'), 'kaydedilmiş ama kayıt noktası olmayan hal');
    fs.unlinkSync(copy.path);

    await p.restore('bolum.txt', first.oid);
    assert.equal(fs.readFileSync(file, 'utf8'), 'ilk hali');
    const hist = await p.history();
    assert.equal(hist[0].kind, 'restore');
    // Geri yüklemeden önceki (kaydedilmemiş) hal de geçmişte
    const before = await p.readAt(hist[1].oid, 'bolum.txt');
    assert.equal(before.toString(), 'kaydedilmiş ama kayıt noktası olmayan hal');
});

test('onarım: bozulmuş dal referansı günlükteki son sağlam kayda döner', async () => {
    const root = h.tmpDir();
    const p = await h.openProject({ root, id: 'onarim' });
    h.write(path.join(p.dir, 'a.txt'), 'bir');
    await p.snapshot();
    h.write(path.join(p.dir, 'a.txt'), 'bir iki');
    const good = await p.snapshot();

    const refFile = path.join(p.gitdir, 'refs', 'heads', BRANCH);
    // Elektrik kesintisi: yarım yazılmış / var olmayan kayda işaret eden referans
    fs.writeFileSync(refFile, '0123456789abcdef0123456789abcdef01234567\n');
    const p2 = new Project({ id: 'onarim', name: 'Tezim', dir: p.dir, gitdir: p.gitdir });
    await p2.open();
    assert.equal(await p2.head(), good.oid);

    fs.writeFileSync(refFile, '');
    const p3 = new Project({ id: 'onarim', name: 'Tezim', dir: p.dir, gitdir: p.gitdir });
    await p3.open();
    assert.equal(await p3.head(), good.oid);
    // Onarımdan sonra kayıt almaya devam edebilmeli
    h.write(path.join(p.dir, 'a.txt'), 'bir iki üç');
    const next = await p3.snapshot();
    assert.equal(await p3.parentOf(next.oid), good.oid);
});

test('kelime sürekliliği: telefondan/GitHub webden gelen "words"süz kayıttan sonra toplam düşmez', async () => {
    const p = await h.openProject();
    h.write(path.join(p.dir, 'tez.txt'), 'bir iki üç dört');
    h.write(path.join(p.dir, 'eski.txt'), 'silinecek dosya');
    const s1 = await p.snapshot();
    assert.equal(s1.total, 6);

    // Telefondan dosya ekleyen ve bir dosya silen kayıt (words yok)
    const head = await p.head();
    const files = new Map(await p.treeFiles(head));
    const blob = await git.writeBlob({ fs, gitdir: p.gitdir, blob: Buffer.from('telefondan yazılan beş kelime') });
    files.set('telefon.txt', blob);
    files.delete('eski.txt');
    const tree = await p.writeTreeFromMap(files);
    const who = { name: 'Telefon', email: 't@x', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 };
    const mobile = await git.writeCommit({
        fs,
        gitdir: p.gitdir,
        commit: { message: `Telefondan eklendi\n\nacadamiv: ${JSON.stringify({ v: 1, kind: 'mobile', changed: ['telefon.txt'] })}\n`, tree, parent: [head], author: who, committer: who }
    });
    // Ayrıca hiç trailer'ı olmayan (GitHub web) bir kayıt
    const web = await git.writeCommit({
        fs,
        gitdir: p.gitdir,
        commit: { message: 'Update README\n', tree, parent: [mobile], author: who, committer: who }
    });
    await p.setHead(web);
    // Çalışma klasörünü kayda uydur
    h.write(path.join(p.dir, 'telefon.txt'), 'telefondan yazılan beş kelime');
    fs.unlinkSync(path.join(p.dir, 'eski.txt'));

    h.write(path.join(p.dir, 'tez.txt'), 'bir iki üç dört beş');
    const s2 = await p.snapshot();
    assert.deepEqual(s2.changed, ['tez.txt']);
    assert.equal(s2.delta['tez.txt'], 1);
    assert.equal(s2.total, 5 + 4, 'tez (5) + telefon (4) kelime; silinen dosya düşer');
    const { meta } = parseMessage((await git.readCommit({ fs, gitdir: p.gitdir, oid: s2.oid })).commit.message);
    assert.deepEqual(meta.words, { 'tez.txt': 5, 'telefon.txt': 4 });
});

test('büyük dosya (>50 MB): geçmişe girmez, belleğe okunmaz, uyarı listesinde görünür', async () => {
    assert.equal(config.MAX_FILE_BYTES, 50 * 1024 * 1024);
    const p = await h.openProject();
    const big = path.join(p.dir, 'uydu', 'goruntu.tif');
    h.bigFile(big, 70 * 1024 * 1024);
    h.write(path.join(p.dir, 'tez.txt'), 'küçük dosya');
    const guard = h.guardReads(f => path.resolve(f) === path.resolve(big));
    try {
        const s = await p.snapshot();
        assert.deepEqual(s.changed, ['tez.txt']);
        assert.deepEqual(p.skippedLarge, ['uydu/goruntu.tif']);
        assert.ok(p.largeFiles.has('uydu/goruntu.tif'));
        const tree = await p.treeFiles(s.oid);
        assert.equal(tree.has('uydu/goruntu.tif'), false);
        const st = await p.status();
        assert.equal(st.files.has('uydu/goruntu.tif'), false);
        const d = await p.diff('uydu/goruntu.tif', s.oid, 'working');
        assert.equal(d.supported, false);
        await assert.rejects(p.readAt('working', 'uydu/goruntu.tif'), e => e.code === 'ETOOLARGE');
        assert.equal(await p.snapshot(), null);
    } finally {
        guard.restore();
    }
    assert.deepEqual(guard.hits, [], 'büyük dosya readFileSync ile okunmamalı');
});

test('kilitli/okunamayan dosya lockedFiles listesine girer, okununca çıkar', async () => {
    const p = await h.openProject();
    const f = path.join(p.dir, 'acik.txt');
    h.write(f, 'bir iki');
    const origOpen = fs.openSync;
    fs.openSync = function (file, ...rest) {
        if (path.resolve(String(file)) === path.resolve(f)) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
        return origOpen.call(this, file, ...rest);
    };
    try {
        await p.snapshot();
        assert.ok(p.lockedFiles.has('acik.txt'));
    } finally {
        fs.openSync = origOpen;
    }
    h.write(f, 'bir iki üç');
    const s = await p.snapshot();
    assert.deepEqual(s.changed, ['acik.txt']);
    assert.equal(p.lockedFiles.has('acik.txt'), false);
});
