const test = require('node:test');
const assert = require('node:assert');
const facts = require('../app/core/facts');
const I18N = require('../app/i18n/strings');
const T = (k, v) => I18N.text(k, v);

// Çok uzun değişiklik (tezin tamamı yeniden yapıştırılmış gibi): kart küçük kalmalı
test('olgu kartı uzun değişiklikte bile küçük kalır ve bölümleri içerir', () => {
    const added = [];
    for (let i = 0; i < 3000; i++) added.push(`Paragraf ${i}: kentsel ısı adası etkisi uydu verisiyle ölçüldü. Ayrıntılar tabloda.`);
    added.splice(10, 0, '4. BULGULAR');
    const f = facts.changeFacts({ added, removed: ['Eski özet paragrafı burada kaldırıldı.'], sections: ['3. Yöntem'] });
    const card = facts.factsText(f, 'Tez.docx');
    assert.ok(card.length <= 900, `kart ${card.length} karakter`);
    assert.match(card, /Section: 4\. BULGULAR \(new\)/);
    assert.match(card, /^\+ Paragraf 0: kentsel ısı adası etkisi uydu verisiyle ölçüldü\.$/m);
    assert.equal(f.nAdded, 3001);
    assert.ok(!f.small);
    const tpl = facts.templateChange(f, T);
    assert.match(tpl, /3001|3\.001|3,001/);
});

test('küçük değişiklikte şablon doğrudan metni söyler', () => {
    const edited = [{ old: 'yüzde 12', new: 'yüzde 14' }];
    const f = facts.changeFacts({ edited });
    assert.ok(f.small);
    const out = facts.templateChange(f, T, { edited });
    assert.match(out, /yüzde 12/);
    assert.match(out, /yüzde 14/);
});

test('model çıktısı denetlenir: etiket kopyası ve uydurma reddedilir', () => {
    const card = 'Paragraphs added: 2 (~30 words).\nSection: 3. Yöntem\n+ Örneklem 120 öğrenciden oluşuyor.';
    assert.equal(facts.vet('Paragraphs added: 2', card), null);
    assert.equal(facts.vet('+ Örneklem 120', card), null);
    assert.equal(facts.vet('Harika bir iş çıkardın, tebrikler!', card), null);
    assert.ok(facts.vet('Yöntem bölümüne 120 öğrencilik örneklemi ekledin.', card));
    assert.equal(facts.vet('x'.repeat(400), card), null);
});

test('başlık sezgisi', () => {
    assert.ok(facts.looksHeading('2.3 Veri Seti'));
    assert.ok(facts.looksHeading('BÖLÜM 4'));
    assert.ok(facts.looksHeading('SONUÇ'));
    assert.ok(!facts.looksHeading('Bu çalışmada veriler toplandı.'));
});
