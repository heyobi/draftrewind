import { registerRootComponent } from 'expo';
import { installErrorLog } from './src/diag';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// Yakalanmamış hatalar cihazdaki küçük hata kaydına yazılır (Ayarlar › Gelişmiş › Sorun bildir)
installErrorLog();
registerRootComponent(App);
