// DraftRewind Pro: tek seferlik satın alma (StoreKit 2). Ücretsiz sürümde projeler sınırsızdır ama yalnızca
// bu cihazda durur; Pro bulut bağlantılarını açar (GitHub, Google Drive, iCloud, bilgisayarla QR eşleştirme).
//
// Durum anahtar zincirinde (SecureStore) tutulur: Belgeler klasörü Dosyalar uygulamasında göründüğü için
// oraya yazılan bir dosya elle oluşturulup Pro açılabilirdi. Asıl kaynak StoreKit'tir; açılışta tazelenir.
// Bu sürümden önce bir buluta bağlanmış kurulumlar (TestFlight kullanıcıları) Pro sayılır ("legacy").
import * as SecureStore from 'expo-secure-store';
import * as Store from '../modules/draftrewind-store';
import { recordError } from './diag';

export const PRO_PRODUCT_ID = 'com.draftrewind.app.pro';
const KEY = 'draftrewind.pro';

let state = { pro: false, legacy: false, checked: false };
let loaded = false;
const listeners = new Set();

export const isPro = () => !!(state.pro || state.legacy);
export const isLegacy = () => !!state.legacy && !state.pro;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn(isPro());
    } catch (e) {
      recordError(e, 'pro-listener');
    }
  }
}

async function save(next) {
  state = { ...state, ...next };
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(state));
  } catch (e) {
    recordError(e, 'pro-save');
  }
  notify();
}

// Açılışta bir kez. hadCloud: bu kurulum bu sürümden önce bir buluta bağlanmış mı (kayıtlı oturum var mı)
export async function init({ hadCloud }) {
  if (!loaded) {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) state = { ...state, ...JSON.parse(raw) };
    } catch (e) {
      recordError(e, 'pro-load');
    }
    loaded = true;
  }
  // Bu kontrol yalnızca ilk açılışta yapılır: sonradan giriş yapan yeni kullanıcı "legacy" sayılmaz
  if (!state.checked) await save({ checked: true, legacy: !!hadCloud });
  else notify();
  refresh();
}

// StoreKit'ten tazele (iade edilen satın alma da buradan düşer). Yerel modül yoksa dokunulmaz.
export async function refresh() {
  if (!Store.isNativeModuleLoaded()) return isPro();
  try {
    const owned = await Store.isEntitled(PRO_PRODUCT_ID);
    if (owned !== !!state.pro) await save({ pro: owned });
  } catch (e) {
    recordError(e, 'pro-refresh');
  }
  return isPro();
}

export async function loadProduct() {
  try {
    return await Store.product(PRO_PRODUCT_ID);
  } catch (e) {
    recordError(e, 'pro-product');
    return null;
  }
}

// 'purchased' | 'cancelled' | 'pending' | 'unverified' | 'unavailable'
export async function buy() {
  const r = await Store.purchase(PRO_PRODUCT_ID);
  if (r === 'purchased') await save({ pro: true });
  return r;
}

export async function restore() {
  const owned = await Store.restore(PRO_PRODUCT_ID);
  if (owned) await save({ pro: true });
  return owned;
}

// Pro gerektiren bir işlemden önce: Pro ise hemen true; değilse satın alma ekranı açılır ve kullanıcı
// satın alır/geri yüklerse true döner. Ekranı App.js kaydeder (setPresenter).
let presenter = null;
export function setPresenter(fn) {
  presenter = fn;
}
export async function ensure(reason) {
  if (isPro()) return true;
  if (!presenter) return false;
  return presenter(reason);
}
