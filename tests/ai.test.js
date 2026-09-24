// Yerel yapay zekâ yardımcıları: başlık temizleme ve uydurma kontrolü (model gerektirmez)
const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, grounded, hasContent } = require('../app/core/ai');

const digest = 'File: Bölüm1.docx\nSection: 3. Bulgular\n+ Kent merkezinde yılda 18 mm çökme tespit edilmiştir ve yeraltı suyu ile ilişkilidir.';

test('cleanTitle önek, tırnak ve markdown temizler', () => {
    assert.strictEqual(cleanTitle('**Başlık:** "Yöntem eklendi"'), 'Yöntem eklendi');
    assert.strictEqual(cleanTitle('Title: Added methods\nextra line'), 'Added methods');
    assert.strictEqual(cleanTitle('x'), null);
});

test('grounded: içerikle ilgili başlığı kabul, uydurmayı ve genel başlığı reddeder', () => {
    assert.ok(grounded('Bulgular bölümüne çökme hızı eklendi', digest));
    assert.ok(grounded('Yeraltı suyu ilişkisi eklendi', digest));
    assert.ok(!grounded('Yöntem bölümüne InSAR işleme adımları eklendi', digest));
    assert.ok(!grounded('Bölüm 1 güncellendi', digest));
});

test('hasContent: sadece yeni/silinen dosya varsa yapay zekâya gerek yok', () => {
    assert.ok(hasContent(digest));
    assert.ok(!hasContent('New file: a.txt\nFile deleted: b.docx\n'));
});
