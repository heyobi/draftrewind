// Yerel "DraftrewindGit" Expo modülünün JS girişi: SHA-1 ve zlib, arka plan kuyruğunda.
// Yerel taraf yoksa (Expo Go, Node testleri, eski sürüm) null döner; çağıran saf JS'e düşer.
import { requireOptionalNativeModule } from 'expo';

let Native = null;
try {
  Native = requireOptionalNativeModule('DraftrewindGit');
} catch (e) {
  Native = null;
}

export default Native;
