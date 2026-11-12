// JS entry of the local "DraftrewindStore" Expo module (StoreKit 2, one non-consumable).
// requireOptionalNativeModule returns null when the native side is missing (Expo Go, Android,
// web, an older build); every function then reports "unavailable" instead of throwing.
import { requireOptionalNativeModule } from 'expo';

let Native = null;
try {
  Native = requireOptionalNativeModule('DraftrewindStore');
} catch (e) {
  Native = null;
}

export const isNativeModuleLoaded = () => !!Native;

// { id, displayName, displayPrice } or null
export async function product(id) {
  if (!Native) return null;
  const p = await Native.product(String(id));
  return p && p.id ? p : null;
}

// 'purchased' | 'cancelled' | 'pending' | 'unverified' | 'unavailable'
export async function purchase(id) {
  if (!Native) return 'unavailable';
  return Native.purchase(String(id));
}

export async function isEntitled(id) {
  if (!Native) return false;
  return !!(await Native.isEntitled(String(id)));
}

export async function restore(id) {
  if (!Native) return false;
  return !!(await Native.restore(String(id)));
}
