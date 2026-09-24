const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');
const config = require('../app/core/config');
const drive = require('../app/core/drive');

after(h.cleanup);

const read = f => fs.readFileSync(f, 'utf8');
const VERSIONS = '_Sürümler';

function listVersions(remoteDir) {
    const out = [];
    const walk = d => {
        let entries = [];
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
            if (e.isDirectory()) walk(path.join(d, e.name));
            else out.push(path.relative(path.join(remoteDir, VERSIONS), path.join(d, e.name)).split(path.sep).join('/'));
        }
    };
    walk(path.join(remoteDir, VERSIONS));
    return out;
}

async function setup(name = 'Tezim') {
    const root = h.tmpDir();
    const driveRoot = path.join(root, 'GoogleDrive');
    fs.mkdirSync(driveRoot);
    const p = await h.openProject({ root, name });
    return { root, driveRoot, p, record: { id: p.id, name }, state: {} };
}

async function sync(ctx, kind) {
    const remote = new drive.FolderRemote(ctx.driveRoot);
    await remote.prepare(ctx.p, ctx.record);
    const res = await drive.reconcile(ctx.p, remote, ctx.state, kind);
    return { res, remote, rdir: remote.dir };
}

test('Drive klasör modu: 8 senaryo (ilk yükleme … tekrar çalıştırma)', async t => {
    const ctx = await setup();
    const L = rel => path.join(ctx.p.dir, ...rel.split('/'));
    h.write(L('tez.txt'), 'birinci taslak');
    h.write(L('bolumler/giris.txt'), 'giriş');

    let rdir;
    await t.test('1) ilk yükleme', async () => {
        const { res, rdir: d } = await sync(ctx);
        rdir = d;
        assert.equal(path.basename(rdir), 'Tezim');
        assert.deepEqual(res.uploaded.sort(), ['bolumler/giris.txt', 'tez.txt']);
        assert.equal(read(path.join(rdir, 'tez.txt')), 'birinci taslak');
        assert.equal(read(path.join(rdir, 'bolumler', 'giris.txt')), 'giriş');
        assert.ok(fs.existsSync(path.join(rdir, '.draftrewind-proje.json')));
    });

    await t.test('2) aynı isimli ikinci proje → "Tezim (2)"', async () => {
        const other = await h.openProject({ root: h.tmpDir(), name: 'Tezim' });
        h.write(path.join(other.dir, 'baska.txt'), 'başka proje');
        const rec = { id: other.id, name: 'Tezim' };
        const remote = new drive.FolderRemote(ctx.driveRoot);
        await remote.prepare(other, rec);
        assert.equal(rec.driveFolderName, 'Tezim (2)');
        await drive.reconcile(other, remote, {});
        assert.ok(fs.existsSync(path.join(ctx.driveRoot, 'DraftRewind', 'Tezim (2)', 'baska.txt')));
        assert.equal(fs.existsSync(path.join(rdir, 'baska.txt')), false);
        // Kayıtlı adla tekrar hazırlanınca aynı klasör bulunur
        const again = new drive.FolderRemote(ctx.driveRoot);
        await again.prepare(other, rec);
        assert.equal(path.basename(again.dir), 'Tezim (2)');
    });

    await t.test('3) Drive\'da düzenleme → bilgisayara indirilir', async () => {
        h.write(path.join(rdir, 'tez.txt'), 'Drive webde düzenlendi');
        const { res } = await sync(ctx);
        assert.deepEqual(res.downloaded, ['tez.txt']);
        assert.equal(read(L('tez.txt')), 'Drive webde düzenlendi');
        assert.deepEqual(res.conflicts, []);
    });

    await t.test('4) bilgisayarda düzenleme → yüklenir + sürüm kopyası', async () => {
        h.write(L('tez.txt'), 'bilgisayarda yazılan yeni paragraf');
        const { res } = await sync(ctx);
        assert.deepEqual(res.uploaded, ['tez.txt']);
        assert.equal(read(path.join(rdir, 'tez.txt')), 'bilgisayarda yazılan yeni paragraf');
        const versions = listVersions(rdir);
        assert.equal(versions.length, 1);
        assert.match(versions[0], /tez\.txt$/);
        assert.equal(read(path.join(rdir, VERSIONS, versions[0])), 'bilgisayarda yazılan yeni paragraf');
    });

    await t.test('5) iki tarafta da düzenleme → "(Drive\'dan)" kopyası, hiçbir şey kaybolmaz', async () => {
        h.write(L('tez.txt'), 'yerel sürüm (bilgisayar)');
        h.write(path.join(rdir, 'tez.txt'), 'uzak sürüm (telefon)');
        const { res } = await sync(ctx);
        const alt = "tez (Drive'dan).txt";
        assert.deepEqual(res.conflicts, [alt]);
        assert.equal(read(L('tez.txt')), 'yerel sürüm (bilgisayar)');
        assert.equal(read(L(alt)), 'uzak sürüm (telefon)');
        assert.equal(read(path.join(rdir, 'tez.txt')), 'yerel sürüm (bilgisayar)');
        assert.equal(read(path.join(rdir, alt)), 'uzak sürüm (telefon)');
    });

    await t.test('6) Drive\'da yeni dosya → indirilir', async () => {
        h.write(path.join(rdir, 'telefon', 'not.txt'), 'telefondan not');
        const { res } = await sync(ctx);
        assert.deepEqual(res.downloaded, ['telefon/not.txt']);
        assert.equal(read(L('telefon/not.txt')), 'telefondan not');
    });

    await t.test('7) bilgisayarda silme → Drive\'da _Sürümler\'e "(silindi)" olarak taşınır', async () => {
        fs.unlinkSync(L('bolumler/giris.txt'));
        const { res } = await sync(ctx);
        assert.deepEqual(res.archived, ['bolumler/giris.txt']);
        assert.equal(fs.existsSync(path.join(rdir, 'bolumler', 'giris.txt')), false);
        const archived = listVersions(rdir).filter(v => v.includes('(silindi)'));
        assert.equal(archived.length, 1);
        assert.match(archived[0], /^bolumler\/.* giris \(silindi\)\.txt$/);
        assert.equal(read(path.join(rdir, VERSIONS, archived[0])), 'giriş');
    });

    await t.test('8) tekrar çalıştırma hiçbir şey yapmaz (idempotent)', async () => {
        const before = listVersions(rdir).length;
        for (let i = 0; i < 2; i++) {
            const { res } = await sync(ctx);
            assert.deepEqual(res, { uploaded: [], downloaded: [], conflicts: [], archived: [] });
        }
        assert.equal(listVersions(rdir).length, before);
    });
});

test('Drive: büyük dosya (70 MB) Drive\'a akışla gider, git geçmişine girmez, belleğe okunmaz', async () => {
    const ctx = await setup('Uydu');
    const rel = 'veri/sahne.tif';
    const big = path.join(ctx.p.dir, 'veri', 'sahne.tif');
    h.bigFile(big, 70 * 1024 * 1024, 'v1');
    h.write(path.join(ctx.p.dir, 'tez.txt'), 'metin');
    const localMd5 = await drive.md5File(big);

    let rdir;
    const bigPaths = f => /sahne(\s\(Drive'dan\))?\.tif/.test(f) || f.includes('.draftrewind.tmp');
    const guard = h.guardReads(bigPaths);
    try {
        // Geçmişe girmez
        const s = await ctx.p.snapshot();
        assert.deepEqual(s.changed, ['tez.txt']);
        assert.equal((await ctx.p.treeFiles(s.oid)).has(rel), false);
        assert.deepEqual(ctx.p.skippedLarge, [rel]);

        // Drive'a gider (en son hali)
        const r1 = await sync(ctx);
        rdir = r1.rdir;
        assert.ok(r1.res.uploaded.includes(rel));
        const remoteBig = path.join(rdir, 'veri', 'sahne.tif');
        assert.equal(fs.statSync(remoteBig).size, 70 * 1024 * 1024);
        assert.equal(await drive.md5File(remoteBig), localMd5);
        assert.equal(ctx.state.base[rel], localMd5);
        assert.equal(ctx.state.bigMd5[rel].md5, localMd5, 'büyük dosya md5 önbelleği kalıcı');
        // Geçici dosya kalmamalı
        assert.deepEqual(fs.readdirSync(path.join(rdir, 'veri')), ['sahne.tif']);

        // Yerelde değişti → yüklenir; 200 MB altı olduğu için sürüm kopyası alınır
        h.bigFile(big, 72 * 1024 * 1024, 'v2');
        const r2 = await sync(ctx, 'star');
        assert.deepEqual(r2.res.uploaded, [rel]);
        assert.equal(listVersions(rdir).filter(v => v.endsWith('.tif')).length, 1);

        // Sürüm sınırının üstündeki dosyaların _Sürümler kopyası tutulmaz
        const oldMax = config.DRIVE_VERSION_MAX_BYTES;
        config.DRIVE_VERSION_MAX_BYTES = 71 * 1024 * 1024;
        try {
            h.bigFile(big, 75 * 1024 * 1024, 'v3');
            const r3 = await sync(ctx, 'star');
            assert.deepEqual(r3.res.uploaded, [rel]);
            assert.equal(listVersions(rdir).filter(v => v.endsWith('.tif')).length, 1);
        } finally {
            config.DRIVE_VERSION_MAX_BYTES = oldMax;
        }

        // Drive'da değişti → akışla indirilir
        h.bigFile(remoteBig, 80 * 1024 * 1024, 'drive');
        const r4 = await sync(ctx);
        assert.deepEqual(r4.res.downloaded, [rel]);
        assert.equal(fs.statSync(big).size, 80 * 1024 * 1024);
        assert.equal(await drive.md5File(big), await drive.md5File(remoteBig));

        // İki tarafta da değişti → "(Drive'dan)" kopyası, ikisi de korunur
        h.bigFile(big, 81 * 1024 * 1024, 'local');
        h.bigFile(remoteBig, 82 * 1024 * 1024, 'remote');
        const r5 = await sync(ctx);
        assert.deepEqual(r5.res.conflicts, ["veri/sahne (Drive'dan).tif"]);
        assert.equal(fs.statSync(big).size, 81 * 1024 * 1024);
        assert.equal(fs.statSync(path.join(ctx.p.dir, 'veri', "sahne (Drive'dan).tif")).size, 82 * 1024 * 1024);
        assert.equal(fs.statSync(remoteBig).size, 81 * 1024 * 1024);
        assert.equal(fs.statSync(path.join(rdir, 'veri', "sahne (Drive'dan).tif")).size, 82 * 1024 * 1024);

        // Tekrar: hiçbir şey yapılmaz; geçici dosya kalmaz
        const r6 = await sync(ctx);
        assert.deepEqual(r6.res, { uploaded: [], downloaded: [], conflicts: [], archived: [] });
        assert.equal(fs.readdirSync(path.join(ctx.p.dir, 'veri')).some(n => n.includes('.tmp')), false);

        // Git geçmişi hâlâ büyük dosyaları içermiyor
        const s2 = await ctx.p.snapshot();
        const head = await ctx.p.head();
        const tree = await ctx.p.treeFiles(head);
        assert.equal([...tree.keys()].some(k => k.endsWith('.tif')), false, JSON.stringify(s2 && s2.changed));
    } finally {
        guard.restore();
    }
    assert.deepEqual(guard.hits, [], 'büyük dosyalar readFileSync ile belleğe okunmamalı');
});

// ---------------------------------------------------------------------------
// Drive API (hesap modu): resumable yükleme ve akışla indirme, sahte fetch ile
// ---------------------------------------------------------------------------
function fakeDrive() {
    const files = new Map(); // id → { name, parents, data: Buffer }
    const sessions = new Map();
    const calls = [];
    let nextId = 1;
    let failOnce = true;
    const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    const fetch = async (url, opts = {}) => {
        const u = new URL(url);
        const method = opts.method || 'GET';
        const headers = Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
        calls.push({ method, url: u.pathname + u.search, range: headers['content-range'], len: opts.body ? opts.body.length : 0 });
        if (u.host === 'upload.test') {
            const s = sessions.get(u.pathname);
            const cr = headers['content-range'];
            const m = cr.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
            if (m) {
                // İkinci parçada bir kez ağ hatası
                if (failOnce && Number(m[1]) > 0) {
                    failOnce = false;
                    throw new TypeError('fetch failed');
                }
                assert.equal(Number(m[1]), s.data.length, 'parça kaldığı yerden devam etmeli');
                s.data = Buffer.concat([s.data, Buffer.from(opts.body)]);
            }
            if (s.data.length < s.size) return new Response(null, { status: 308, headers: s.data.length ? { Range: `bytes=0-${s.data.length - 1}` } : {} });
            const id = s.id || `f${nextId++}`;
            files.set(id, { name: s.meta.name || (files.get(id) || {}).name, parents: s.meta.parents || (files.get(id) || {}).parents, data: s.data });
            return json({ id, md5Checksum: h.md5(s.data) });
        }
        if (u.pathname.startsWith('/upload/drive/v3/files') && u.searchParams.get('uploadType') === 'resumable') {
            const sid = `/s${sessions.size + 1}`;
            const id = u.pathname.split('/')[5] || null;
            sessions.set(sid, { id, meta: JSON.parse(opts.body || '{}'), size: Number(headers['x-upload-content-length']), data: Buffer.alloc(0) });
            return new Response(null, { status: 200, headers: { Location: `https://upload.test${sid}` } });
        }
        const m = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
        if (m && u.searchParams.get('alt') === 'media') {
            const f = files.get(m[1]);
            return f ? new Response(f.data) : new Response(null, { status: 404 });
        }
        if (u.pathname === '/drive/v3/files' && method === 'GET') {
            const q = u.searchParams.get('q');
            if (q.includes("appProperties has { key='draftrewindId' and value='proj-1' }")) return json({ files: [{ id: 'eski', name: 'Tezim', createdTime: '2026-01-01T00:00:00Z' }] });
            return json({ files: [] });
        }
        if (u.pathname === '/drive/v3/files' && method === 'POST') return json({ id: `folder${nextId++}`, name: JSON.parse(opts.body).name });
        throw new Error(`beklenmeyen istek ${method} ${url}`);
    };
    return { fetch, files, calls };
}

test('Drive API: resumable yükleme (8 MB parçalar, kopan bağlantıdan devam) ve diske akışla indirme', async () => {
    const fake = fakeDrive();
    const origFetch = globalThis.fetch;
    globalThis.fetch = fake.fetch;
    try {
        const api = new drive.DriveApi(() => ({ access_token: 't', expires_at: Date.now() + 3600e3 }), () => {});
        api.retryScale = 0;
        const dir = h.tmpDir();
        const src = path.join(dir, 'sahne.tif');
        const data = require('crypto').randomBytes(20 * 1024 * 1024 + 12345);
        fs.writeFileSync(src, data);

        const r = await api.uploadFile({ name: 'sahne.tif', parentId: 'p1', file: src });
        assert.equal(r.md5Checksum, h.md5(data));
        assert.ok(fake.files.get(r.id).data.equals(data));
        const puts = fake.calls.filter(c => c.method === 'PUT' && /^bytes \d/.test(c.range || ''));
        for (const c of puts) {
            assert.ok(c.len <= config.DRIVE_CHUNK_BYTES);
            const [a, b, total] = c.range.match(/\d+/g).map(Number);
            if (b + 1 !== total) assert.equal(c.len % (256 * 1024), 0, 'son parça dışında 256 KB katı');
            assert.equal(b - a + 1, c.len);
        }
        assert.ok(fake.calls.some(c => c.method === 'PUT' && c.range === `bytes */${data.length}`), 'kopan bağlantıdan sonra durum sorulmalı');

        // Mevcut dosyanın güncellenmesi (PATCH ile resumable oturum)
        const data2 = Buffer.concat([data, Buffer.from('ek')]);
        const r2 = await api.upload({ id: r.id, name: 'sahne.tif', parentId: 'p1', buf: data2 });
        assert.equal(r2.id, r.id);
        assert.ok(fake.files.get(r.id).data.equals(data2));

        // İndirme doğrudan diske
        const dst = path.join(dir, 'indirilen.tif');
        const sum = await api.downloadTo(r.id, dst);
        assert.equal(sum, h.md5(data2));
        assert.ok(fs.readFileSync(dst).equals(data2));

        // prepare: kayıtlı kimlik yoksa etiketli (eski) klasör bulunur, yenisi oluşturulmaz
        const remote = new drive.ApiRemote(api);
        const rec = {};
        await remote.prepare({ id: 'proj-1', name: 'Tezim' }, rec);
        assert.equal(rec.driveFolderId, 'eski');
        assert.equal(fake.calls.filter(c => c.method === 'POST' && c.url.startsWith('/drive/v3/files')).length, 0);
    } finally {
        globalThis.fetch = origFetch;
    }
});
