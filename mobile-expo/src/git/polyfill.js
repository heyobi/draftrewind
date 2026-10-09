// isomorphic-git genel (global) bir Buffer bekler; React Native/Hermes'te yoktur.
// Motorun ilk içe aktardığı dosyadır.
import { Buffer } from 'buffer';
import { nativeGit, toNative } from './native.js';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;

// SHA-1: isomorphic-git varsa crypto.subtle.digest'i kullanır. Telefonda bunu yerel modül (arka plan
// kuyruğu) sağlar; yalnızca SHA-1, başka algoritma istenirse hata (çağıran kendi yoluna döner).
if (nativeGit && !(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest)) {
  const subtle = {
    async digest(algorithm, data) {
      const name = typeof algorithm === 'string' ? algorithm : algorithm && algorithm.name;
      if (String(name).toUpperCase() !== 'SHA-1') throw new Error('desteklenmiyor');
      const hex = await nativeGit.sha1(toNative(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
      const out = new Uint8Array(20);
      for (let i = 0; i < 20; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
      return out.buffer;
    },
  };
  globalThis.crypto = globalThis.crypto || {};
  try {
    globalThis.crypto.subtle = subtle;
  } catch (e) {}
}
