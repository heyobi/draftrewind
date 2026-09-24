// Ortak test yardımcıları: geçici klasörler, kodla üretilen .docx/.xlsx dosyaları, yerel git sunucusu.
// (İkili fikstür yok; her şey test sırasında jszip ile üretilir.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const JSZip = require('jszip');

const I18N = require('../app/i18n/strings');
I18N.setLanguage('tr');

const made = [];
function tmpDir(prefix = 'drw-') {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    made.push(d);
    return d;
}

function cleanup() {
    while (made.length) {
        const d = made.pop();
        try {
            fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (e) {}
    }
}

function write(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
}

const md5 = buf => crypto.createHash('md5').update(buf).digest('hex');

// Seyrek/hızlı büyük dosya: boyut ftruncate ile verilir, başına ve sonuna birkaç bayt yazılır.
function bigFile(file, size, tag = 'x') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(file, 'w');
    try {
        fs.ftruncateSync(fd, size);
        fs.writeSync(fd, Buffer.from(`BIG-${tag}-start`), 0, undefined, 0);
        fs.writeSync(fd, Buffer.from(`BIG-${tag}-end`), 0, undefined, size - 32);
    } finally {
        fs.closeSync(fd);
    }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// paras: ['düz paragraf', { text: 'Başlık', heading: true }, ...]
async function makeDocx(paras) {
    const body = paras
        .map(p => (typeof p === 'string' ? { text: p } : p))
        .map(p => `<w:p>${p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t xml:space="preserve">${esc(p.text)}</w:t></w:r></w:p>`)
        .join('');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
    return zip.generateAsync({ type: 'nodebuffer' });
}

// cells: { A1: 1, B1: 'metin', ... } (tek sayfa, satır içi metin)
async function makeXlsx(cells, sheetName = 'Veri') {
    const rows = {};
    for (const [ref, v] of Object.entries(cells)) {
        const r = Number(ref.match(/\d+/)[0]);
        (rows[r] = rows[r] || []).push(
            typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`
        );
    }
    const data = Object.keys(rows)
        .sort((a, b) => a - b)
        .map(r => `<row r="${r}">${rows[r].join('')}</row>`)
        .join('');
    const zip = new JSZip();
    zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="${esc(sheetName)}" sheetId="1"/></sheets></workbook>`);
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`);
    return zip.generateAsync({ type: 'nodebuffer' });
}

async function openProject(opts = {}) {
    const { Project } = require('../app/core/engine');
    const root = opts.root || tmpDir();
    const dir = opts.dir || path.join(root, 'proje');
    fs.mkdirSync(dir, { recursive: true });
    const p = new Project({
        id: opts.id || crypto.randomUUID(),
        name: opts.name || 'Tezim',
        dir,
        gitdir: opts.gitdir || path.join(root, 'depo.git'),
        author: { name: 'Test' }
    });
    await p.open();
    return p;
}

// Belirli dosyalar için fs.readFileSync / fs.promises.readFile çağrısını yakalar (büyük dosya asla belleğe okunmamalı).
function guardReads(isForbidden) {
    const origSync = fs.readFileSync;
    const origAsync = fs.promises.readFile;
    const hits = [];
    fs.readFileSync = function (p, ...rest) {
        if (typeof p === 'string' && isForbidden(p)) hits.push(p);
        return origSync.call(this, p, ...rest);
    };
    fs.promises.readFile = function (p, ...rest) {
        if (typeof p === 'string' && isForbidden(p)) hits.push(p);
        return origAsync.call(this, p, ...rest);
    };
    return {
        hits,
        restore() {
            fs.readFileSync = origSync;
            fs.promises.readFile = origAsync;
        }
    };
}

// ---------------------------------------------------------------------------
// Yerel "GitHub": git http-backend'i CGI olarak çalıştıran küçük HTTP sunucusu
// ---------------------------------------------------------------------------
function startGitServer(projectRoot) {
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        const env = {
            ...process.env,
            GIT_PROJECT_ROOT: projectRoot,
            GIT_HTTP_EXPORT_ALL: '1',
            REQUEST_METHOD: req.method,
            PATH_INFO: decodeURIComponent(u.pathname),
            QUERY_STRING: u.search.replace(/^\?/, ''),
            CONTENT_TYPE: req.headers['content-type'] || '',
            REMOTE_USER: 'test',
            REMOTE_ADDR: '127.0.0.1',
            GIT_HTTP_MAX_REQUEST_BUFFER: '1000M'
        };
        if (req.headers['content-length']) env.CONTENT_LENGTH = req.headers['content-length'];
        if (req.headers['content-encoding']) env.HTTP_CONTENT_ENCODING = req.headers['content-encoding'];
        if (req.headers['git-protocol']) env.GIT_PROTOCOL = req.headers['git-protocol'];
        const cgi = spawn('git', ['http-backend'], { env, windowsHide: true });
        req.pipe(cgi.stdin);
        let head = Buffer.alloc(0);
        let headersDone = false;
        cgi.stdout.on('data', chunk => {
            if (headersDone) return res.write(chunk);
            head = Buffer.concat([head, chunk]);
            let idx = head.indexOf('\r\n\r\n');
            let sepLen = 4;
            if (idx < 0) {
                idx = head.indexOf('\n\n');
                sepLen = 2;
            }
            if (idx < 0) return;
            headersDone = true;
            let status = 200;
            for (const line of head.slice(0, idx).toString('utf8').split(/\r?\n/)) {
                const m = line.match(/^([^:]+):\s*(.*)$/);
                if (!m) continue;
                if (m[1].toLowerCase() === 'status') status = Number(m[2].split(' ')[0]);
                else res.setHeader(m[1], m[2]);
            }
            res.writeHead(status);
            res.write(head.slice(idx + sepLen));
        });
        cgi.stdout.on('end', () => res.end());
        cgi.stderr.on('data', () => {});
        cgi.on('error', () => {
            res.writeHead(500);
            res.end();
        });
    });
    return new Promise(resolve => {
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

function initBareRepo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    execFileSync('git', ['init', '--bare', '--quiet', file], { windowsHide: true });
    execFileSync('git', ['--git-dir', file, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { windowsHide: true });
    execFileSync('git', ['--git-dir', file, 'config', 'http.receivepack', 'true'], { windowsHide: true });
}

module.exports = { tmpDir, cleanup, write, md5, bigFile, makeDocx, makeXlsx, openProject, guardReads, startGitServer, initBareRepo, I18N };
