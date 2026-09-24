// İsteğe bağlı yerel yapay zekâ: llama.cpp (llama-server) + Qwen3.5-2B (Unsloth GGUF, Apache-2.0).
// Uygulamayla birlikte gelmez; kullanıcı Ayarlar'dan isterse indirilir (motor ~17 MB + model ~1.3 GB)
// ve SHA256 ile doğrulanır. Tamamen bilgisayarda çalışır, hiçbir metin dışarı gönderilmez.
// Zayıf bilgisayarlar için: sadece gerektiğinde başlar, düşük öncelikte ve en fazla 4 çekirdekle
// çalışır, 5 dakika kullanılmazsa kapanıp belleği geri verir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const JSZip = require('jszip');

const ENGINE = {
    win32_x64: {
        version: 'b11160',
        url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11160/llama-b11160-bin-win-cpu-x64.zip',
        sha256: 'b144d125972c57eb30062524269b31bf981dfb81d36fad6a1494e18814a06acc',
        size: 17 * 1024 * 1024,
        exe: 'llama-server.exe'
    }
};

const MODEL = {
    id: 'qwen3.5-2b-ud-q4kxl',
    name: 'Qwen3.5 2B (Unsloth, Q4)',
    file: 'Qwen3.5-2B-UD-Q4_K_XL.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/Qwen3.5-2B-UD-Q4_K_XL.gguf',
    sha256: '0af96165ea615bea39a04118d63f0b6d35908aea850ee4a51aa6151d851b8b35',
    size: 1339752704,
    license: 'Apache-2.0'
};

const IDLE_STOP_MS = 5 * 60 * 1000;
const RECOMMENDED_RAM = 6 * 1024 * 1024 * 1024;

function platformKey() {
    return `${process.platform}_${process.arch}`;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = http.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

// İndirir, akış halinde SHA256 hesaplar; doğrulanmazsa dosyayı siler.
async function download(url, target, expectedSha, expectedSize, onProgress, signal) {
    const part = `${target}.part`;
    const res = await fetch(url, { signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || expectedSize || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(part);
    let received = 0;
    let last = 0;
    try {
        for await (const chunk of res.body) {
            hash.update(chunk);
            received += chunk.length;
            if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
            if (Date.now() - last > 250) {
                last = Date.now();
                onProgress(received, total);
            }
        }
        await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
    } catch (e) {
        out.destroy();
        try { fs.unlinkSync(part); } catch (err) {}
        throw e;
    }
    onProgress(received, total);
    if (hash.digest('hex') !== expectedSha) {
        try { fs.unlinkSync(part); } catch (e) {}
        throw Object.assign(new Error('checksum'), { code: 'ECHECKSUM' });
    }
    fs.renameSync(part, target);
}

class LocalAI {
    constructor(dir, onEvent) {
        this.dir = dir;
        this.onEvent = onEvent || (() => {});
        this.engineDir = path.join(dir, 'engine');
        this.modelPath = path.join(dir, MODEL.file);
        this.proc = null;
        this.port = null;
        this.starting = null;
        this.idleTimer = null;
        this.install = null; // { phase, received, total, controller }
        this.queue = Promise.resolve();
    }

    engineInfo() {
        return ENGINE[platformKey()] || null;
    }

    supported() {
        return !!this.engineInfo();
    }

    engineReady() {
        const e = this.engineInfo();
        return !!e && fs.existsSync(path.join(this.engineDir, e.exe)) && fs.existsSync(path.join(this.engineDir, '.version-' + e.version));
    }

    modelReady() {
        try {
            return fs.statSync(this.modelPath).size === MODEL.size;
        } catch (e) {
            return false;
        }
    }

    status() {
        return {
            supported: this.supported(),
            installed: this.engineReady() && this.modelReady(),
            installing: this.install ? { phase: this.install.phase, received: this.install.received, total: this.install.total } : null,
            running: !!this.proc,
            model: { name: MODEL.name, size: MODEL.size, license: MODEL.license },
            engineSize: this.engineInfo() ? this.engineInfo().size : 0,
            totalRam: os.totalmem(),
            ramOk: os.totalmem() >= RECOMMENDED_RAM
        };
    }

    async installAll() {
        if (!this.supported()) throw Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' });
        if (this.install) return;
        const controller = new AbortController();
        this.install = { phase: 'engine', received: 0, total: 0, controller };
        const progress = (received, total) => {
            this.install.received = received;
            this.install.total = total;
            this.onEvent({ type: 'ai', status: this.status() });
        };
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            if (!this.engineReady()) {
                const e = this.engineInfo();
                const zipPath = path.join(this.dir, 'engine.zip');
                await download(e.url, zipPath, e.sha256, e.size, progress, controller.signal);
                const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
                fs.rmSync(this.engineDir, { recursive: true, force: true });
                fs.mkdirSync(this.engineDir, { recursive: true });
                for (const [name, entry] of Object.entries(zip.files)) {
                    if (entry.dir) continue;
                    const target = path.join(this.engineDir, name);
                    if (!target.startsWith(this.engineDir)) continue; // zip içinden dışarı yazma girişimi
                    fs.mkdirSync(path.dirname(target), { recursive: true });
                    fs.writeFileSync(target, await entry.async('nodebuffer'));
                }
                fs.writeFileSync(path.join(this.engineDir, '.version-' + e.version), '');
                fs.unlinkSync(zipPath);
            }
            if (!this.modelReady()) {
                this.install.phase = 'model';
                await download(MODEL.url, this.modelPath, MODEL.sha256, MODEL.size, progress, controller.signal);
            }
        } finally {
            this.install = null;
            this.onEvent({ type: 'ai', status: this.status() });
        }
    }

    cancelInstall() {
        if (this.install) this.install.controller.abort();
    }

    async remove() {
        this.cancelInstall();
        await this.stop();
        fs.rmSync(this.dir, { recursive: true, force: true });
        this.onEvent({ type: 'ai', status: this.status() });
    }

    async ensureServer() {
        if (this.proc && this.port) return this.port;
        if (this.starting) return this.starting;
        if (!this.engineReady() || !this.modelReady()) throw Object.assign(new Error('not installed'), { code: 'ENOTINSTALLED' });
        this.starting = (async () => {
            const port = await freePort();
            const threads = Math.max(2, Math.min(4, os.cpus().length - 2));
            const proc = spawn(path.join(this.engineDir, this.engineInfo().exe), ['-m', this.modelPath, '--host', '127.0.0.1', '--port', String(port), '-c', '4096', '-t', String(threads), '--no-webui'], {
                cwd: this.engineDir,
                windowsHide: true,
                stdio: 'ignore'
            });
            try { os.setPriority(proc.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {}
            proc.on('exit', () => {
                if (this.proc === proc) {
                    this.proc = null;
                    this.port = null;
                    this.onEvent({ type: 'ai', status: this.status() });
                }
            });
            this.proc = proc;
            // Model yüklenene kadar bekle (zayıf bilgisayarda ~5-15 sn)
            const deadline = Date.now() + 90 * 1000;
            while (Date.now() < deadline) {
                if (!this.proc) throw new Error('engine exited');
                try {
                    const r = await fetch(`http://127.0.0.1:${port}/health`);
                    if (r.ok) {
                        this.port = port;
                        this.onEvent({ type: 'ai', status: this.status() });
                        return port;
                    }
                } catch (e) {}
                await new Promise(r => setTimeout(r, 500));
            }
            await this.stop();
            throw new Error('engine start timeout');
        })();
        try {
            return await this.starting;
        } finally {
            this.starting = null;
        }
    }

    // Windows'ta alt süreçler ana uygulamayla birlikte ölmez: önceki bir çökmeden kalmış
    // motor süreçlerini (sadece bizim motor klasörümüzdekileri) bul ve kapat.
    cleanupOrphans() {
        if (process.platform !== 'win32' || !fs.existsSync(this.engineDir)) return;
        const dir = this.engineDir.replace(/'/g, "''");
        const ps = `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${dir}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        try {
            spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
        } catch (e) {}
    }

    touch() {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS);
    }

    async stop() {
        clearTimeout(this.idleTimer);
        const proc = this.proc;
        this.proc = null;
        this.port = null;
        if (proc) {
            try { proc.kill(); } catch (e) {}
        }
    }

    // Tek seferde bir istek (zayıf bilgisayarı boğmamak için sıraya alınır)
    complete({ system, user, maxTokens = 120, temperature = 0.2, timeoutMs = 60000 }) {
        const run = this.queue.then(async () => {
            const port = await this.ensureServer();
            this.touch();
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: controller.signal,
                    body: JSON.stringify({
                        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                        max_tokens: maxTokens,
                        temperature,
                        chat_template_kwargs: { enable_thinking: false }
                    })
                });
                const data = await res.json();
                const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
                if (!text) throw new Error('empty answer');
                return text.trim();
            } finally {
                clearTimeout(timer);
                this.touch();
            }
        });
        this.queue = run.catch(() => {});
        return run;
    }
}

// Model çıktısını tek satırlık başlığa indirger (tırnak, "Başlık:" öneki, markdown temizlenir)
function cleanTitle(text) {
    let t = String(text || '').replace(/[\p{Extended_Pictographic}️‍]/gu, '').split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    t = t.replace(/^(\*\*)?(başlık|title)\s*:?\s*(\*\*)?\s*/i, '').replace(/^["'“”‘’«»*#\-\s]+|["'“”‘’«»*\s]+$/g, '');
    // İki cümle yazdıysa ilkini al; hâlâ uzunsa kelime sınırında kes (iyi başlığı atmak yerine kısalt)
    if (t.length > 110) {
        const first = t.match(/^.{20,105}?[.!?](?=\s)/);
        t = first ? first[0] : t.slice(0, 100).replace(/\s+\S*$/, '') + '…';
    }
    t = t.replace(/\.$/, '');
    if (t.length < 4) return null;
    return t;
}

// Olgu kartındaki sayılar: küçük değişiklikte (≤20 kelime) yapay zekâ gereksiz, kural tabanlı başlık daha doğru
function digestWords(digest) {
    let n = 0;
    for (const m of String(digest).matchAll(/\(~(\d+) words\)/g)) n += Number(m[1]);
    return n;
}

// Uydurma kontrolü: başlıktaki anlamlı kelimelerden en az biri değişiklik metninde geçmeli.
// (Küçük modeller bazen girdide olmayan bir şey "özetler"; o zaman kural tabanlı başlık kullanılır.)
// Her başlıkta geçebilen genel kelimeler (kök olarak): eşleşme sayılmaz
const GENERIC = ['bolum', 'ekle', 'eklen', 'cikar', 'silin', 'paragr', 'dosya', 'guncel', 'duzel', 'degis', 'yeni', 'metin', 'belge', 'yapil', 'icin', 'olara', 'secti', 'chapt', 'secti', 'added', 'remov', 'delet', 'updat', 'chang', 'parag', 'file', 'docum', 'text', 'with', 'from', 'into', 'about'];

function grounded(title, source) {
    const norm = s => String(s).toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
    // Sadece içerik satırları (+/-) ve bölüm başlıkları kaynak sayılır; dosya adı sayılmaz
    const src = norm(
        String(source)
            .split('\n')
            .filter(l => /^([+-] |Section: )/.test(l))
            .join('\n')
    );
    const stems = norm(title)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(w => w.length >= 4)
        .map(w => w.slice(0, 5)) // Türkçe ekler: "bölümüne" ~ "bolum", "çökmesi" ~ "cokme"
        .filter(s => !GENERIC.some(g => s.startsWith(g) || g.startsWith(s)));
    if (stems.some(s => src.includes(s))) return true;
    // Arayüz dili belgeden farklıysa (İngilizce başlık, Türkçe tez) kelimeler tutmaz; o zaman
    // sayılar (2019, 18 mm) ve özel adlar (Landsat, Sentinel) kaynakta geçiyorsa yeterli sayılır
    const anchors = String(title).match(/\d{2,}|\b\p{Lu}[\p{L}]{3,}\b/gu) || [];
    return anchors.some(a => src.includes(norm(a)));
}

// Değişiklik metninde gerçek içerik satırı (+/-) var mı? Sadece "yeni dosya/silindi" ise yapay zekâya gerek yok.
function hasContent(digest) {
    return /^[+-] \S/m.test(digest);
}

module.exports = { LocalAI, MODEL, cleanTitle, grounded, hasContent, digestWords };
