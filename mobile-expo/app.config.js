// Dinamik yapılandırma: her şey app.json'dan gelir (tek kaynak; iş akışları sürüm/derleme numarasını
// app.json'a yazar). Burada yalnızca İSTEĞE BAĞLI iCloud Drive yetkileri eklenir:
// DRAFTREWIND_ICLOUD=1 iken. Apple Developer'da App ID'ye iCloud (CloudKit/Documents) yeteneği ve
// iCloud.com.draftrewind.app kapsayıcısı eklenip ana uygulamanın profili yenilenmeden bu bayrak
// açılmamalı; yoksa imzalama başarısız olur. Bayrak kapalıyken çıktı app.json ile birebir aynıdır.
const fs = require('fs');
const path = require('path');

const ICLOUD_CONTAINER = 'iCloud.com.draftrewind.app';

// Ana uygulamanın profili bu kapsayıcıyı gerçekten içeriyor mu? (Portalda kapsayıcı App ID'ye
// atanmadan yenilenen profilde liste boş kalır; o durumda yetki eklemek imzalamayı bozar.)
function profileHasContainer() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'profiles', 'DraftRewind_AppStore_Profile.mobileprovision'), 'latin1');
    const m = raw.match(/<key>com\.apple\.developer\.icloud-container-identifiers<\/key>\s*<array>([\s\S]*?)<\/array>/);
    return !!m && m[1].includes(ICLOUD_CONTAINER);
  } catch (e) {
    return false;
  }
}

module.exports = ({ config }) => {
  if (process.env.DRAFTREWIND_ICLOUD !== '1') return config;
  if (!profileHasContainer()) {
    console.warn(`[app.config] DRAFTREWIND_ICLOUD=1 ama profilde ${ICLOUD_CONTAINER} yok; iCloud yetkileri eklenmedi.`);
    return config;
  }
  const ios = config.ios || {};
  return {
    ...config,
    ios: {
      ...ios,
      entitlements: {
        ...(ios.entitlements || {}),
        'com.apple.developer.icloud-container-identifiers': [ICLOUD_CONTAINER],
        'com.apple.developer.icloud-services': ['CloudDocuments'],
        'com.apple.developer.ubiquity-container-identifiers': [ICLOUD_CONTAINER],
      },
      infoPlist: {
        ...(ios.infoPlist || {}),
        NSUbiquitousContainers: {
          [ICLOUD_CONTAINER]: {
            NSUbiquitousContainerIsDocumentScopePublic: true,
            NSUbiquitousContainerName: 'DraftRewind',
            NSUbiquitousContainerSupportedFolderLevels: 'Any',
          },
        },
      },
    },
  };
};
