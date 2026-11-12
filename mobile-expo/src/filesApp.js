// "Dosyalar'da aç": iOS Dosyalar uygulamasını projenin ya da dosyanın bulunduğu klasörde açar.
// Klasör yoksa önce oluşturulur (boş proje de açılabilsin). Açılamazsa yol elle bulunsun diye gösterilir.
import { Alert, Linking } from 'react-native';
import { filesAppUrl } from './git/paths';
import { recordError } from './diag';
import { t } from './i18n';

export async function openInFiles(dir, hintPath) {
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    await Linking.openURL(filesAppUrl(dir.uri));
  } catch (e) {
    recordError(e, 'openInFiles');
    Alert.alert(t('files.openFailedTitle'), t('files.openFailedBody', { path: hintPath || '' }), [{ text: t('common.ok') }]);
  }
}
