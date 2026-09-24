// Kaydedilmemiş iş koruması (Windows): açık Word/Excel belgelerinden henüz kaydedilmemiş olanların
// güncel içeriğini, belgeye dokunmadan (Word: WordOpenXML, Excel: SaveCopyAs) kurtarma klasörüne yazar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const docs = require('./docs');
const config = require('./config');

const SCRIPT = String.raw`
param([string]$OutDir, [string]$Roots)
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$roots = @($Roots.Split('|') | Where-Object { $_ })
function RootOf([string]$p) {
  foreach ($r in $roots) { if ($p.ToLower().StartsWith($r.ToLower())) { return $r } }
  return ''
}
$out = New-Object System.Collections.ArrayList
$utf8 = New-Object System.Text.UTF8Encoding $false
$word = $null
try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application') } catch {}
if ($word) {
  foreach ($d in @($word.Documents)) {
    try {
      $full = [string]$d.FullName
      $root = RootOf $full
      $untitled = ([string]$d.Path) -eq ''
      if ($root -or $untitled) {
        if (-not $d.Saved) {
          $f = Join-Path $OutDir ([guid]::NewGuid().ToString() + '.xml')
          [IO.File]::WriteAllText($f, $d.WordOpenXML, $utf8)
          [void]$out.Add([pscustomobject]@{ app = 'word'; doc = $full; name = [string]$d.Name; root = $root; file = $f; saved = $false })
        } else {
          [void]$out.Add([pscustomobject]@{ app = 'word'; doc = $full; name = [string]$d.Name; root = $root; file = ''; saved = $true })
        }
      }
    } catch {}
  }
}
$excel = $null
try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') } catch {}
if ($excel) {
  foreach ($b in @($excel.Workbooks)) {
    try {
      $full = [string]$b.FullName
      $root = RootOf $full
      $untitled = ([string]$b.Path) -eq ''
      if ($root -or $untitled) {
        if (-not $b.Saved) {
          $ext = [IO.Path]::GetExtension($full); if (-not $ext) { $ext = '.xlsx' }
          $f = Join-Path $OutDir ([guid]::NewGuid().ToString() + $ext)
          $b.SaveCopyAs($f)
          [void]$out.Add([pscustomobject]@{ app = 'excel'; doc = $full; name = [string]$b.Name; root = $root; file = $f; saved = $false })
        } else {
          [void]$out.Add([pscustomobject]@{ app = 'excel'; doc = $full; name = [string]$b.Name; root = $root; file = ''; saved = $true })
        }
      }
    } catch {}
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

class Guardian {
    constructor(workDir) {
        this.workDir = workDir;
        this.running = false;
        this.lastHashes = {};
        fs.mkdirSync(workDir, { recursive: true });
        this.scriptPath = path.join(workDir, 'koruyucu.ps1');
        // BOM'lu UTF-8: PowerShell 5.1 Türkçe karakterleri doğru okusun
        fs.writeFileSync(this.scriptPath, '﻿' + SCRIPT, 'utf8');
    }

    runScript(roots) {
        const outDir = path.join(this.workDir, 'gecici');
        fs.mkdirSync(outDir, { recursive: true });
        return new Promise(resolve => {
            execFile(
                'powershell.exe',
                ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, '-OutDir', outDir, '-Roots', roots.join('|')],
                { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
                (err, stdout) => {
                    let list = [];
                    try {
                        const parsed = JSON.parse((stdout || '').trim() || '[]');
                        list = Array.isArray(parsed) ? parsed : [parsed];
                    } catch (e) {}
                    resolve(list);
                }
            );
        });
    }

    // projects: [{ id, dir }] → döner: [{ projectId, rel, docName }]
    async run(projects) {
        if (process.platform !== 'win32' || this.running || projects.length === 0) return [];
        this.running = true;
        const rescued = [];
        try {
            const roots = projects.map(p => path.resolve(p.dir) + path.sep);
            const found = await this.runScript(roots);
            for (const item of found) {
                const project = item.root
                    ? projects.find(p => path.resolve(p.dir) + path.sep === item.root) ||
                      projects.find(p => item.root.toLowerCase().startsWith(path.resolve(p.dir).toLowerCase()))
                    : projects.length === 1 ? projects[0] : null; // Adı konmamış yeni belge: yalnızca tek proje varsa oraya
                if (!project) continue;
                const rescueDir = path.join(project.dir, config.RESCUE_DIR);
                const baseName = item.root ? path.basename(item.doc, path.extname(item.doc)) : item.name;
                const ext = item.app === 'word' ? '.docx' : path.extname(item.doc) || '.xlsx';
                const target = path.join(rescueDir, `${baseName} (kaydedilmemiş son hali)${ext}`);

                if (item.saved) {
                    // Kullanıcı kaydetti: kurtarma kopyası artık gereksiz (geçmişte yine duruyor)
                    if (fs.existsSync(target)) {
                        try { fs.unlinkSync(target); } catch (e) {}
                    }
                    continue;
                }
                try {
                    let buf;
                    if (item.app === 'word') {
                        buf = await docs.flatOpcToDocx(fs.readFileSync(item.file, 'utf8'));
                    } else {
                        buf = fs.readFileSync(item.file);
                    }
                    const hash = crypto.createHash('sha1').update(buf).digest('hex');
                    if (this.lastHashes[target] !== hash || !fs.existsSync(target)) {
                        fs.mkdirSync(rescueDir, { recursive: true });
                        fs.writeFileSync(target, buf);
                        this.lastHashes[target] = hash;
                        rescued.push({ projectId: project.id, rel: path.relative(project.dir, target).split(path.sep).join('/'), docName: item.name });
                    }
                } catch (e) {
                    console.warn('[DraftRewind] Kurtarma yazılamadı:', item.name, e.message);
                } finally {
                    try { fs.unlinkSync(item.file); } catch (e) {}
                }
            }
            // Kaydedilmiş hali olan kurtarma dosyalarını temizle (belge kapatılmışsa da)
            for (const p of projects) {
                const dir = path.join(p.dir, config.RESCUE_DIR);
                if (!fs.existsSync(dir)) continue;
                const openTargets = new Set(
                    found.filter(f => !f.saved).map(f => {
                        const baseName = f.root ? path.basename(f.doc, path.extname(f.doc)) : f.name;
                        return `${baseName} (kaydedilmemiş son hali)`.toLowerCase();
                    })
                );
                for (const name of fs.readdirSync(dir)) {
                    const stem = path.basename(name, path.extname(name)).toLowerCase();
                    if (openTargets.has(stem)) continue;
                    // Belge kapanmış: kurtarma kopyasını 3 gün tut, sonra kaldır (geçmişte her zaman erişilebilir)
                    try {
                        const st = fs.statSync(path.join(dir, name));
                        if (Date.now() - st.mtimeMs > 3 * 24 * 3600 * 1000) fs.unlinkSync(path.join(dir, name));
                    } catch (e) {}
                }
                try {
                    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
                } catch (e) {}
            }
        } finally {
            this.running = false;
        }
        return rescued;
    }
}

module.exports = { Guardian };
