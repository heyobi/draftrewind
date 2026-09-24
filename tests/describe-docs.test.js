const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const h = require('./helpers');
const { describeFile, describeSnapshot } = require('../app/core/describe');
const docs = require('../app/core/docs');

const T = (k, v) => h.I18N.text(k, v);

const BASE = [{ text: '1. Giriş', heading: true }, 'Bu tez uydu görüntülerini inceler.', 'Veri seti iki yıllıktır.'];

test('describe: yeni bölüm başlığı eklendi', async () => {
    const a = await h.makeDocx(BASE);
    const b = await h.makeDocx([...BASE, { text: '2. Yöntem', heading: true }, 'Sınıflandırma için rastgele orman kullanıldı.']);
    const d = await describeFile('tez.docx', a, b);
    assert.equal(d.phrase, T('desc.sectionAdded', { h: 'Yöntem' }));
    assert.equal(d.title, `tez: ${d.phrase}`);
});

test('describe: bölüme paragraf eklendi', async () => {
    const a = await h.makeDocx(BASE);
    const b = await h.makeDocx([...BASE, 'Üçüncü paragraf eklendi.', 'Dördüncü paragraf da eklendi.']);
    const d = await describeFile('tez.docx', a, b);
    assert.equal(d.phrase, T('desc.parasAdded', { where: T('desc.whereOneTo', { h: 'Giriş' }), n: 2 }));
});

test('describe: küçük düzeltmeler', async () => {
    const a = await h.makeDocx(BASE);
    const b = await h.makeDocx([BASE[0], 'Bu tez uydu görüntülerini ayrıntılı inceler.', BASE[2]]);
    const d = await describeFile('tez.docx', a, b);
    assert.equal(d.phrase, T('desc.minor', { where: T('desc.whereOne', { h: 'Giriş' }) }));
});

test('describe: kaynakça girdileri eklendi', async () => {
    const a = Buffer.from('@article{kaya2020,\n title={A}\n}\n');
    const b = Buffer.from('@article{kaya2020,\n title={A}\n}\n@book{yilmaz2021,\n title={B}\n}\n@misc{demir2022,\n title={C}\n}\n');
    const d = await describeFile('kaynaklar.bib', a, b);
    assert.equal(d.phrase, T('desc.bibAdded', { n: 2 }));
    assert.equal(d.title, d.phrase);
});

test('describe: Excel hücreleri değişti', async () => {
    const a = await h.makeXlsx({ A1: 'Yıl', B1: 'Alan', A2: 2020, B2: 15 });
    const b = await h.makeXlsx({ A1: 'Yıl', B1: 'Alan', A2: 2020, B2: 17, C2: 'not' });
    const d = await describeFile('veri.xlsx', a, b);
    assert.equal(d.phrase, T('desc.cells', { n: 2 }));
});

test('describe: çok dosyalı özet başlığı ve gövdesi', async () => {
    const a = await h.makeDocx(BASE);
    const b = await h.makeDocx([...BASE, { text: '2. Yöntem', heading: true }, 'Yeni.']);
    const s = await describeSnapshot(
        [
            { rel: 'tez.docx', oldBuf: a, newBuf: b },
            { rel: 'notlar.txt', oldBuf: null, newBuf: Buffer.from('yeni') }
        ],
        { 'tez.docx': 3, 'notlar.txt': 1 }
    );
    assert.ok(s.title.includes('Yöntem'));
    assert.ok(s.title.includes(T('common.andMore', { n: 1 }).trim()));
    assert.equal(s.body.split('\n').length, 2);
});

test('docs.flatOpcToDocx: Word Flat OPC → .docx gidiş-dönüş', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const xml = `<?xml version="1.0" standalone="yes"?>
<?mso-application progid="Word.Document"?>
<pkg:package xmlns:pkg="http://schemas.microsoft.com/office/2006/xmlPackage">
  <pkg:part pkg:name="/_rels/.rels" pkg:contentType="application/vnd.openxmlformats-package.relationships+xml">
    <pkg:xmlData><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships></pkg:xmlData>
  </pkg:part>
  <pkg:part pkg:name="/word/document.xml" pkg:contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml">
    <pkg:xmlData><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Kurtarılan paragraf</w:t></w:r></w:p><w:p><w:r><w:t>İkinci &amp; son</w:t></w:r></w:p></w:body></w:document></pkg:xmlData>
  </pkg:part>
  <pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png" pkg:compression="store">
    <pkg:binaryData>iVBORw0KGgo=</pkg:binaryData>
  </pkg:part>
</pkg:package>`;
    const buf = await docs.flatOpcToDocx(xml);
    const zip = await JSZip.loadAsync(buf);
    const ct = await zip.file('[Content_Types].xml').async('string');
    assert.ok(ct.includes('PartName="/word/document.xml"'));
    assert.ok(ct.includes('PartName="/word/media/image1.png"'));
    assert.ok(!ct.includes('PartName="/_rels/.rels"'));
    assert.ok(zip.file('_rels/.rels'));
    assert.deepEqual([...(await zip.file('word/media/image1.png').async('nodebuffer'))], [...Buffer.from('iVBORw0KGgo=', 'base64')]);
    assert.deepEqual(await docs.extractLines('kurtarilan.docx', buf), ['Kurtarılan paragraf', 'İkinci & son']);
    assert.equal(await docs.countWords('kurtarilan.docx', buf), 4); // '&' kelime sayılmaz
    await assert.rejects(docs.flatOpcToDocx('<pkg:package></pkg:package>'));
});
