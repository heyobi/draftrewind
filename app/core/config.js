// Uygulama kimlikleri.
//  - GitHub: github.com/settings/developers → OAuth App → "Enable Device Flow" işaretli.
//  - Google: app/core/google-oauth.json (git'e girmez; Google Cloud "draftrewind" projesi, Desktop app istemcisi).
// Ortam değişkenleri (DRAFTREWIND_*) dosyadaki değerleri ezer.
let googleFile = {};
try {
    googleFile = require('./google-oauth.json');
} catch (e) {}
// GitHub secret'ı sadece "süreli jeton" açıksa oturumu yenilemek için gerekir (git'e girmez).
let githubFile = {};
try {
    githubFile = require('./github-oauth.json');
} catch (e) {}

module.exports = {
    // DraftRewind GitHub OAuth App (device flow açık). Client ID gizli değildir.
    GITHUB_CLIENT_ID: process.env.DRAFTREWIND_GITHUB_CLIENT_ID || githubFile.client_id || 'Ov23liD2VS140X5UplHW',
    GITHUB_CLIENT_SECRET: process.env.DRAFTREWIND_GITHUB_CLIENT_SECRET || githubFile.client_secret || '',
    GOOGLE_CLIENT_ID: process.env.DRAFTREWIND_GOOGLE_CLIENT_ID || googleFile.client_id || '',
    GOOGLE_CLIENT_SECRET: process.env.DRAFTREWIND_GOOGLE_CLIENT_SECRET || googleFile.client_secret || '',

    // Otomatik kayıt: son dosya değişikliğinden bu kadar sonra kayıt noktası alınır.
    SNAPSHOT_DEBOUNCE_MS: 6 * 1000,
    // İki otomatik kayıt noktası arasında en az bu kadar süre. Kaydedilmiş dosya zaten diskte;
    // bu sınır, sık Ctrl+S yapıldığında geçmişin (ve GitHub deposunun) şişmesini önler.
    // Önemli an, kurtarma, uyku ve kapanma kayıtları beklemez.
    MIN_SNAPSHOT_GAP_MS: 3 * 60 * 1000,
    // İzleyici bir olayı kaçırırsa diye periyodik tarama.
    RESCAN_INTERVAL_MS: 3 * 60 * 1000,
    // Kaydedilmemiş Word/Excel içeriğini kurtarma aralığı.
    GUARDIAN_INTERVAL_MS: 4 * 60 * 1000,
    // Buluta gönderme: kayıtlardan sonra bu kadar bekleyip toplu gönderir.
    SYNC_DEBOUNCE_MS: 45 * 1000,
    // Drive'da (web, telefon) yapılan düzenlemeleri kontrol etme sıklığı.
    // GitHub'daki yeni kayıtları (telefondan eklenen dosyalar, diğer bilgisayarlar) kontrol etme sıklığı.
    GITHUB_POLL_MS: 3 * 60 * 1000,
    DRIVE_POLL_MS: 4 * 60 * 1000,
    // Drive'daki "Sürümler" klasörüne aynı dosya için en fazla bu sıklıkta kopya.
    DRIVE_VERSION_EVERY_MS: 30 * 60 * 1000,
    // Sürüm geçmişi (zaman makinesi + GitHub) sınırı. GitHub 50 MB üstünde uyarır, 100 MB üstünü
    // reddeder, tek gönderim en fazla 2 GB olabilir. Bu sınırın üstündeki dosyalar geçmişe girmez;
    // Google Drive'a yalnızca "en son hali" olarak yedeklenir. Motor bu dosyaları asla belleğe okumaz.
    MAX_FILE_BYTES: 50 * 1024 * 1024,
    // Drive: bu boyutun üstündeki dosyalar belleğe alınmaz, diskten akışla (stream) okunur/yazılır.
    DRIVE_STREAM_BYTES: 64 * 1024 * 1024,
    // Drive API: bu boyutun üstü "resumable" (parça parça, kaldığı yerden devam eden) yüklenir.
    DRIVE_RESUMABLE_BYTES: 5 * 1024 * 1024,
    // Resumable yükleme parça boyutu (256 KB'nin katı olmalı).
    DRIVE_CHUNK_BYTES: 8 * 1024 * 1024,
    // Bu boyutun üstündeki dosyaların "_Sürümler" kopyası tutulmaz (Drive kotasını doldurmasın).
    DRIVE_VERSION_MAX_BYTES: 200 * 1024 * 1024,

    RESCUE_DIR: '_DraftRewind Kurtarma'
};
