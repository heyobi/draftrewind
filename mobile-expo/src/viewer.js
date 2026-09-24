// Belgeyi WebView içinde gösterecek HTML'i hazırlar (Word için docx-preview, Excel için SheetJS).
// Kütüphaneler uygulamayla birlikte gelir (bkz. viewerLibs.js) ve HTML'e satır içi <script> olarak gömülür:
// çevrimdışı çalışır, üçüncü taraf sunucuya istek gitmez. libs: { jszip, docx, xlsx, diff } → kaynak metni.

// Kütüphane kodunu <script> etiketine güvenle göm ("</script" dizisi etiketi erken kapatmasın).
// Not: replace yerine split/join — kaynak metindeki "$&" gibi diziler yorumlanmasın.
function inlineScript(code) {
  if (!code) return '';
  return '<script>' + String(code).split('</script').join('<\\/script') + '</script>';
}
const scripts = (libs, names) => names.map((n) => inlineScript(libs && libs[n])).join('');

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return global.btoa ? global.btoa(bin) : btoa(bin);
}

const BASE_STYLE = (dark) => `
  html,body{margin:0;background:${dark ? '#0f0f17' : '#ecebf7'};-webkit-text-size-adjust:100%;font-family:-apple-system,system-ui,sans-serif;color:${dark ? '#eee' : '#1c1a33'}}
  #msg{padding:40px 20px;text-align:center;color:#8a88a6;font-size:15px}
`;

// Görüntüleyicideki metinler; uygulama seçili dile göre labels geçer (bkz. i18n.viewerLabels).
const DEFAULT_LABELS = {
  preparing: 'Sayfalar hazırlanıyor…',
  preparingSheet: 'Tablo hazırlanıyor…',
  failed: 'Belge gösterilemedi: ',
  comparing: 'Karşılaştırılıyor…',
  sameParagraphs: '⋯ {n} paragraf aynı ⋯',
  sameParagraphsOne: '⋯ 1 paragraf aynı ⋯',
  firstVersion: 'İlk hali',
  words: '{n} kelime',
  wordsOne: '{n} kelime',
  unchanged: 'Metin değişmemiş (biçim veya düzen değişmiş olabilir).',
  compareFailed: 'Karşılaştırılamadı: ',
};
const labelsOf = (labels) => ({ ...DEFAULT_LABELS, ...(labels || {}) });
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// <script> içine gömülecek JSON: "</script" gibi dizilerin etiketi kapatmasını önler.
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

const DECODE = (L) => `
  var L=${jsonForScript(L)};
  function b64ToBytes(b64){var bin=atob(b64);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
  function done(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');}
  function fail(e){document.getElementById('msg').textContent=L.failed+e;done();}
`;

export function wordHtml(b64, dark, labels, libs) {
  const L = labelsOf(labels);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>${BASE_STYLE(dark)}
  .docx-wrapper{background:transparent!important;padding:12px 0!important}
  .docx-wrapper>section.docx{box-shadow:0 4px 24px rgba(0,0,0,.18)!important;margin:0 auto 14px!important}
</style>
${scripts(libs, ['jszip', 'docx'])}</head>
<body><div id="msg">${escHtml(L.preparing)}</div><div id="c"></div>
<script>${DECODE(L)}
try{
  docx.renderAsync(b64ToBytes("${b64}"),document.getElementById('c'),null,{inWrapper:true,ignoreLastRenderedPageBreak:true,breakPages:true}).then(function(){
    document.getElementById('msg').remove();
    var w=document.querySelector('.docx-wrapper'),s=document.querySelector('section.docx');
    if(w&&s){var scale=(window.innerWidth-16)/s.offsetWidth; if(scale<1) w.style.zoom=scale;}
    done();
  }).catch(fail);
}catch(e){fail(e)}
</script></body></html>`;
}

export function sheetHtml(b64, dark, labels, libs) {
  const L = labelsOf(labels);
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>${BASE_STYLE(dark)}
  h3{margin:18px 14px 8px;font-size:15px}
  .wrap{overflow:auto;margin:0 10px 14px;border-radius:12px;background:${dark ? '#1a1a28' : '#fff'}}
  table{border-collapse:collapse;font-size:13px}
  td{border:1px solid ${dark ? '#2b2b40' : '#e6e3f3'};padding:6px 10px;white-space:nowrap}
  tr:first-child td{font-weight:700;background:${dark ? '#202032' : '#f5f4fb'}}
</style>${scripts(libs, ['xlsx'])}</head>
<body><div id="msg">${escHtml(L.preparingSheet)}</div><div id="c"></div>
<script>${DECODE(L)}
try{
  var wb=XLSX.read(b64ToBytes("${b64}"),{type:'array'});var html='';
  wb.SheetNames.forEach(function(n){html+='<h3>'+n.replace(/</g,'&lt;')+'</h3><div class="wrap">'+XLSX.utils.sheet_to_html(wb.Sheets[n],{header:'',footer:''})+'</div>';});
  document.getElementById('msg').remove();document.getElementById('c').innerHTML=html;done();
}catch(e){fail(e)}
</script></body></html>`;
}

// textHtml'de kullanıcıya görünen sabit metin yok; labels diğerleriyle aynı imza için kabul edilir.
export function textHtml(text, dark, labels) {
  const esc = String(text).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${BASE_STYLE(dark)} pre{white-space:pre-wrap;word-wrap:break-word;font:13px/1.55 ui-monospace,Menlo,monospace;padding:16px;margin:0}</style></head>
<body><pre>${esc}</pre><script>window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready')</script></body></html>`;
}

// Hermes'te TextDecoder her sürümde yok; küçük bir UTF-8 çözücü.
export function utf8Decode(buf) {
  const b = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i++];
    let cp;
    if (x < 0x80) cp = x;
    else if (x < 0xe0) cp = ((x & 0x1f) << 6) | (b[i++] & 0x3f);
    else if (x < 0xf0) cp = ((x & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    else cp = ((x & 0x07) << 18) | ((b[i++] & 0x3f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

// Renkli karşılaştırma: eski ve yeni hali paragraf paragraf (Word) ya da satır satır karşılaştırır.
// oldB64 null ise dosya bu kayıtta eklenmiştir.
// opts.report: rapor modu — en fazla opts.maxBlocks blok çizilir ve sonuç HTML'i uygulamaya
// { type: 'rendered', html, add, rem, first, unchanged, truncated } mesajıyla gönderilir (PDF raporu için).
export function diffHtml(oldB64, newB64, kind, dark, labels, libs, opts) {
  const L = labelsOf(labels);
  const report = !!(opts && opts.report);
  const maxBlocks = report ? Math.max(1, (opts && opts.maxBlocks) || 300) : 0;
  const c = dark
    ? { bg: '#0f0f17', card: '#1a1a28', text: '#eeedfb', dim: '#9e9cb8', add: '#173222', addT: '#4ade80', del: '#3a1a1e', delT: '#f87171' }
    : { bg: '#f3f2fb', card: '#ffffff', text: '#1c1a33', dim: '#7c7a98', add: '#dcfce7', addT: '#15803d', del: '#fee2e2', delT: '#b91c1c' };
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<style>
  html,body{margin:0;background:${c.bg};color:${c.text};font-family:-apple-system,system-ui,sans-serif;-webkit-text-size-adjust:100%}
  .sum{display:flex;gap:8px;padding:14px 16px 4px;flex-wrap:wrap}
  .chip{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px}
  .a{background:${c.add};color:${c.addT}} .d{background:${c.del};color:${c.delT}} .n{background:${c.card};color:${c.dim}}
  .doc{margin:10px 12px 30px;background:${c.card};border-radius:18px;padding:18px 18px;font:16px/1.6 Georgia,'Times New Roman',serif}
  p{margin:0 0 12px} .same{color:${c.dim}}
  .padd{background:${c.add};border-left:3px solid ${c.addT};padding:4px 8px;border-radius:6px}
  .pdel{background:${c.del};border-left:3px solid ${c.delT};padding:4px 8px;border-radius:6px;text-decoration:line-through;color:${c.dim}}
  ins{background:${c.add};color:${c.addT};text-decoration:none;font-weight:600;border-radius:4px}
  del{background:${c.del};color:${c.delT};border-radius:4px}
  .gap{text-align:center;color:${c.dim};font:12px -apple-system,sans-serif;margin:4px 0 12px}
  #msg{padding:40px 20px;text-align:center;color:${c.dim}}
</style>
${scripts(libs, ['jszip', 'diff'])}</head>
<body><div id="msg">${escHtml(L.comparing)}</div><div id="out"></div>
<script>
var L=${jsonForScript(L)};
function fmt(s,n){return s.split('{n}').join(n);}
function b64ToBytes(b64){var bin=atob(b64);var u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
function done(){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage('ready');}
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]});}
function dec(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}
function words(s){return (s.match(/[^\\s]+/g)||[]).filter(function(w){return /[A-Za-z0-9\\u00C0-\\u024F\\u0400-\\u04FF]/.test(w)}).length;}
async function lines(b64,kind){
  if(!b64) return [];
  var bytes=b64ToBytes(b64);
  if(kind==='word'){
    var zip=await JSZip.loadAsync(bytes);var xml=await zip.file('word/document.xml').async('string');
    return xml.split('</w:p>').map(function(p){var t='';var re=/<w:t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/w:t>|<w:tab\\/>/g,m;while((m=re.exec(p))){t+=m[1]!==undefined?dec(m[1]):' ';}return t.trim();}).filter(Boolean);
  }
  return new TextDecoder().decode(bytes).split(/\\r?\\n/);
}
(async function(){try{
  var kind=${JSON.stringify(kind)};
  var a=await lines(${oldB64 ? `"${oldB64}"` : 'null'},kind), b=await lines("${newB64}",kind);
  var chunks=Diff.diffArrays(a,b), blocks=[], add=0, rem=0;
  for(var i=0;i<chunks.length;i++){var ch=chunks[i],nx=chunks[i+1];
    if(ch.removed&&nx&&nx.added){var n=Math.max(ch.value.length,nx.value.length);
      for(var j=0;j<n;j++){var o=ch.value[j],w=nx.value[j];
        if(o!==undefined&&w!==undefined){var parts=Diff.diffWordsWithSpace(o,w);parts.forEach(function(p){if(p.added)add+=words(p.value);if(p.removed)rem+=words(p.value);});blocks.push({t:'mod',parts:parts});}
        else if(w!==undefined){add+=words(w);blocks.push({t:'add',s:w});} else {rem+=words(o);blocks.push({t:'del',s:o});}}
      i++;}
    else if(ch.added){ch.value.forEach(function(s){add+=words(s);blocks.push({t:'add',s:s});});}
    else if(ch.removed){ch.value.forEach(function(s){rem+=words(s);blocks.push({t:'del',s:s});});}
    else ch.value.forEach(function(s){blocks.push({t:'same',s:s});});
  }
  var show=blocks.map(function(){return false;});
  blocks.forEach(function(bk,i){if(bk.t!=='same')for(var k=i-1;k<=i+1;k++)if(k>=0&&k<blocks.length)show[k]=true;});
  var html='',hidden=0,maxBlocks=${maxBlocks},drawn=0,truncated=false;
  function flush(){if(hidden)html+='<div class="gap">'+esc(fmt(hidden===1?L.sameParagraphsOne:L.sameParagraphs,hidden))+'</div>';hidden=0;}
  blocks.forEach(function(bk,i){if(!show[i]){hidden++;return;}
    if(maxBlocks&&drawn>=maxBlocks){truncated=true;return;}drawn++;flush();
    if(bk.t==='same')html+='<p class="same">'+esc(bk.s)+'</p>';
    else if(bk.t==='add')html+='<p class="padd">'+esc(bk.s)+'</p>';
    else if(bk.t==='del')html+='<p class="pdel">'+esc(bk.s)+'</p>';
    else html+='<p>'+bk.parts.map(function(p){return p.added?'<ins>'+esc(p.value)+'</ins>':p.removed?'<del>'+esc(p.value)+'</del>':esc(p.value)}).join('')+'</p>';});
  flush();
  // Uygulamaya değişikliklerin kısa metin hali (cihaz üstü "Neler değişti?" özeti için):
  // "+ eklenen", "- silinen", "~ [-eski-]{+yeni+}" satırları. 'ready' mesajı ayrıca done() ile gider.
  var cmp=[],clen=0;
  function one(s){return String(s).replace(/\\s+/g,' ').trim();}
  function clip(s){s=one(s);return s.length>400?s.slice(0,400)+'…':s;}
  function ctx(s){s=one(s);return s.length>110?s.slice(0,50)+' … '+s.slice(-50):s;}
  function pushC(line){if(clen<7000){cmp.push(line);clen+=line.length+1;}}
  blocks.forEach(function(bk){
    if(bk.t==='add')pushC('+ '+clip(bk.s));
    else if(bk.t==='del')pushC('- '+clip(bk.s));
    else if(bk.t==='mod')pushC('~ '+clip(bk.parts.map(function(p){return p.added?'{+'+one(p.value)+'+}':p.removed?'[-'+one(p.value)+'-]':ctx(p.value);}).join(' ')));
  });
  try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'diff',text:cmp.join('\\n'),add:add,rem:rem,first:${oldB64 ? 'false' : 'true'}}));}catch(e){}
  var sum='<div class="sum">'+(${oldB64 ? 'false' : 'true'}?'<span class="chip n">'+esc(L.firstVersion)+'</span>':'')+(add?'<span class="chip a">'+esc(fmt(add===1?L.wordsOne:L.words,'+'+add))+'</span>':'')+(rem?'<span class="chip d">'+esc(fmt(rem===1?L.wordsOne:L.words,'−'+rem))+'</span>':'')+'</div>';
  var changed=blocks.some(function(b){return b.t!=='same'});
  document.getElementById('msg').remove();
  document.getElementById('out').innerHTML=changed?sum+'<div class="doc">'+html+'</div>':'<div id="msg">'+esc(L.unchanged)+'</div>';
  if(${report ? 'true' : 'false'}){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'rendered',html:changed?html:'',add:add,rem:rem,first:${oldB64 ? 'false' : 'true'},unchanged:!changed,truncated:truncated}));}catch(e){}}
  done();
}catch(e){document.getElementById('msg').textContent=L.compareFailed+e;
  if(${report ? 'true' : 'false'}){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify({type:'rendered',failed:true,error:String(e)}));}catch(e2){}}
  done();}})();
</script></body></html>`;
}
