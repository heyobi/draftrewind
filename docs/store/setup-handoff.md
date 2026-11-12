# Yayın hazırlığı: tarayıcıda yapılacaklar (yayına gönderme hariç)

Bu belge, kullanıcının bilgisayarında tarayıcıyı kullanabilen bir Claude oturumu (Claude Desktop) içindir.
Amaç: DraftRewind'in iPhone uygulamasını App Store'a **göndermeye hazır** hale getirmek. Son adım olan
**"Add for Review" / "Submit for Review" düğmesine basılmaz**; o kararı kullanıcı verir.

Ayrıntılar ve metinler: `docs/store/app-store.md` (açıklamalar, anahtar kelimeler, review notları).
Site dosyaları: `site/` (index.html, privacy.html, support.html, img/).

## Kurallar

- **Hesaplara giriş kullanıcıya aittir.** Apple, Cloudflare ve Google şifrelerini ve iki adımlı doğrulama
  kodlarını kullanıcı girer. Claude şifre yazmaz, kaydetmez ve istemez.
- **Para gerektiren her adımda durup sor.** Alan adı satın almak, ücretli plan seçmek gibi. Hedef her şeyin
  **ücretsiz** olması.
- **Banka ve vergi bilgilerini kullanıcı kendisi girer.** Claude yalnızca hangi ekranda ne olduğunu söyler.
- **Geri alınamayan adımlar:** Bir satın alma ürününün Product ID'si silinse bile yeniden kullanılamaz. Bu
  yüzden ürünü oluşturmadan önce kimliği bir kez daha kontrol et.
- Her bölümün sonunda kısa bir durum yaz: yapıldı / kullanıcı bekleniyor / engellendi (nedeniyle).

---

## 1. Web sitesi: Cloudflare Pages (ücretsiz)

App Store; gizlilik politikası, destek sayfası ve iletişim e-postası istiyor. Hepsi bu sitede duracak.

**Alan adı:** `draftrewind.com` kullanıcıda zaten var ve Cloudflare hesabında görünmesi gerekiyor. Cloudflare
panelinde **Domains** listesinde olduğunu doğrula ve aşağıdaki adımları bu alan adıyla yap. Yeni bir alan adı
satın alma. Listede yoksa (başka bir kayıt firmasında ya da başka bir hesapta olabilir) dur ve kullanıcıya sor.

### 1.1 Siteyi yayımla
1. dash.cloudflare.com › **Workers & Pages** › **Create** › **Pages** › **Connect to Git**.
2. GitHub'da `heyobi/draftrewind` deposunu seç ve Cloudflare'e yalnızca bu depoya erişim ver.
3. Ayarlar:
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: **boş**
   - Build output directory: **`site`**
4. Proje adı: `draftrewind`. Adres `https://draftrewind.pages.dev` olur. `main`'e yapılan her değişiklik
   siteye kendiliğinden yansır.
5. Kontrol et; üç sayfa da açılmalı:
   - `https://draftrewind.pages.dev/`
   - `https://draftrewind.pages.dev/privacy.html`
   - `https://draftrewind.pages.dev/support.html`

### 1.2 Alan adını bağla (alan adı varsa)
Pages projesi › **Custom domains** › `draftrewind.com` ve `www.draftrewind.com` ekle. Alan adı Cloudflare'deyse
DNS kayıtları kendiliğinden eklenir. HTTPS sertifikasının hazır olmasını bekle, sonra 1.1'deki üç sayfayı
`https://draftrewind.com/...` adresinde kontrol et.

### 1.3 İletişim e-postası
- **Alan adı Cloudflare'deyse (ücretsiz):** Alan adı › **Email** › **Email Routing** › etkinleştir.
  1. Custom address olarak `support@draftrewind.com` ekle.
  2. Hedef olarak kullanıcının kişisel e-posta adresini gir; adresi kullanıcı yazar ve gelen doğrulama
     postasını kendisi onaylar.
  3. Test: `support@draftrewind.com` adresine bir deneme e-postası gönder ve kullanıcının gelen kutusuna
     düştüğünü doğrula.
- **Alan adı yoksa:** Email Routing kullanılamaz. Kullanıcıya hangi adresin iletişim adresi olacağını sor
  (kişisel adresi herkese açık olacak). Sonra 1.4'teki değişiklikleri o adresle yap.

### 1.4 Adres değişirse (alan adı yoksa ya da e-posta farklıysa)
Depodaki şu yerlerde `draftrewind.com` ve `support@draftrewind.com` geçenleri yeni adresle değiştir, commit
edip `main`'e gönder (site kendiliğinden güncellenir):
- `site/index.html`, `site/privacy.html`, `site/support.html`
- `docs/store/app-store.md` (Privacy URL, Support URL)
- `mobile-expo/App.js` içindeki `https://draftrewind.com/?from=app` bağlantısı. Bu değişiklik ancak bir
  sonraki uygulama derlemesinde etkili olur.

---

## 2. Google Cloud: Drive girişini herkese aç

Onay ekranı "Testing" durumunda kalırsa yalnızca test kullanıcıları Google Drive'a bağlanabilir.

1. console.cloud.google.com › DraftRewind projesi › **Google Auth Platform** (ya da **APIs & Services ›
   OAuth consent screen**).
2. **Branding:**
   - App name `DraftRewind`, uygulama logosu (`site/img/icon.png`)
   - Destek e-postası: 1.3'teki adres
   - Ana sayfa: sitenin adresi
   - Gizlilik politikası: `…/privacy.html`
   - Authorized domains: `draftrewind.com`, ya da alan adı yoksa `pages.dev` kullanılamayabilir; bu durumda
     kullanıcıya bildir.
3. **Audience:** Publishing status › **Publish app** › **In production**.
4. İstenen izinler `openid`, `email`, `profile` ve `drive.file`. Bunlar hassas izin sayılmaz, uzun bir
   doğrulama beklenmez. Google marka doğrulaması isterse formu doldur ve durumu bildir.

---

## 3. App Store Connect: yayına gönderme dışındaki her şey

appstoreconnect.apple.com › **Apps** › DraftRewind (Bundle ID `com.draftrewind.app`).

### 3.1 Sözleşmeler (kullanıcı)
**Business** (ya da **Agreements, Tax, and Banking**) › **Paid Apps** sözleşmesi imzalı ve **Active** olmalı.
Banka ve vergi formlarını kullanıcı doldurur. Bu aktif olmadan uygulama içi satın alma çalışmaz.

### 3.2 Uygulama bilgileri (App Information)
- Kategori: **Productivity**, ikinci kategori **Education**.
- **Privacy Policy URL:** `https://draftrewind.com/privacy.html` (ya da 1.4'teki adres).
- **Age Rating:** Ankette tüm sorulara "Yok / Hayır" ver. Uygulamada kullanıcıların birbiriyle iletişimi,
  web tarayıcısı ve kumar yok. Sonuç 4+ olmalı.
- Content Rights: üçüncü taraf içerik yok.
- Yerelleştirme: **English (U.S.)** ana dil, ek olarak **Turkish** ekle.

### 3.3 Fiyat ve bulunabilirlik (Pricing and Availability)
- Uygulama fiyatı: **Free (0 $)**.
- Bulunabilirlik: tüm ülkeler.

### 3.4 Uygulama gizliliği (App Privacy)
- Privacy Policy URL (3.2'deki ile aynı).
- Data Collection: **"No, we do not collect data from this app"**. Sunucu yok, analitik yok; satın almayı
  Apple işliyor.

### 3.5 Uygulama içi satın alma
**Monetization › In-App Purchases › +**
- Type: **Non-Consumable**
- Reference Name: `DraftRewind Pro`
- Product ID: **`com.draftrewind.app.pro`**. Birebir böyle olmalı; uygulama bu kimliği arıyor. Oluşturmadan
  önce iki kez kontrol et.
- Price: taban fiyat **4,99 $ (USD)**. **Türkiye** fiyatını otomatik dönüşüme bırakma, elle yaklaşık
  **₺149,99** seç.
- Availability: tüm ülkeler.
- Localization:
  - EN: Display Name `DraftRewind Pro`, Description `Sync with your computer and back up to the cloud.`
  - TR: Display Name `DraftRewind Pro`, Description `Bilgisayarınla eşitle ve buluta yedekle.`
- Review Information:
  - Screenshot: kullanıcıdan TestFlight'taki satın alma ekranının görüntüsünü iste. Ayarlar'da "Pro'ya geç"
    düğmesi ekranı açar; Pro açık olan bir telefonda bu ekran görünmez, o durumda kullanıcıya bildir.
  - Review Notes: `Unlocks cloud connections (GitHub, Google Drive, iCloud Drive, QR pairing with the
    desktop app). Shown before the first cloud sign-in and from Settings > DraftRewind Pro.`
- Durum **Ready to Submit** olmalı.

### 3.6 Sürüm sayfası (iOS App › 1.0.x › Prepare for Submission)
Metinler `docs/store/app-store.md` içinde; EN ve TR ayrı ayrı doldurulur:
- Promotional Text, Description, Keywords
- Support URL: `…/support.html`
- Marketing URL: sitenin ana sayfası
- Copyright: `2026 DraftRewind`
- **Screenshots:** iPhone 6.9" ya da 6.5" için dil başına 5 görüntü. iPad desteği açık olduğundan 13" iPad
  görüntüleri de gerekli. Görüntüleri kullanıcı telefonda/iPad'de çeker ve verir; Claude yükler. Hangi
  ekranların çekileceği `app-store.md` içinde yazıyor.
- **Build:** TestFlight'taki en yeni derlemeyi seç; işlemesi bitmiş olmalı.
- **In-App Purchases:** Bu bölüme `com.draftrewind.app.pro` ürününü ekle. Apple ilk satın alma ürününü
  sürümle birlikte inceler.
- **App Review Information:**
  - İletişim adı, telefonu ve e-postası: kullanıcı girer.
  - Notes: `app-store.md` içindeki "App Review notes" bölümü.
  - Demo hesabı: test GitHub hesabının kullanıcı adı ve şifresini **kullanıcı yazar**. Belgedeki
    `<TEST_LOGIN>` gibi yer tutucular asla gönderilmez.
- Export compliance sorusu çıkmamalı, çünkü `ITSAppUsesNonExemptEncryption = false` ayarlı. Çıkarsa:
  yalnızca standart HTTPS kullanılıyor, muaf.
- Version Release: **Manually release this version**, böylece onaydan sonra yayın zamanını kullanıcı seçer.

### 3.7 Burada dur
**"Add for Review" / "Submit for Review" düğmesine basma.** Kullanıcıya şunları bildir:
- Tamamlanan her adım
- Eksik kalanlar (ör. ekran görüntüleri, demo hesabı) ve kimin yapacağı
- Sayfada görülen uyarılar

---

## 4. App Store Small Business Program (ücretsiz, yayın değil)

developer.apple.com/app-store/small-business-program › **Enroll**. Apple'ın payı %30 yerine %15 olur.
Başvuruyu kullanıcının onayıyla gönder.

---

## Bitti sayılması için

- [ ] Site yayında, `privacy.html` ve `support.html` açılıyor
- [ ] İletişim e-postası çalışıyor (deneme e-postası ulaştı)
- [ ] Google OAuth onay ekranı **In production**
- [ ] Paid Apps sözleşmesi **Active**
- [ ] App Information, Age Rating, Pricing (Free) ve App Privacy tamam
- [ ] `com.draftrewind.app.pro` ürünü **Ready to Submit**
- [ ] Sürüm sayfası EN + TR dolu; build ve satın alma ürünü seçili
- [ ] Ekran görüntüleri ve demo hesabı: kullanıcıdan bekleniyor ya da tamam
- [ ] **Submit for Review'a basılmadı**
