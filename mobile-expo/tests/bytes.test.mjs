import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'buffer';
import { plainBytes } from '../src/bytes.js';

// expo-file-system yalnızca bilinen typed array adlarını kabul eder; Buffer uygulamayı çökertir
test('plainBytes: Buffer ve diğer görünümler düz Uint8Array olur, içerik aynı kalır', () => {
  const buf = Buffer.from('Bölüm 1 – Giriş');
  const out = plainBytes(buf);
  assert.equal(out.constructor.name, 'Uint8Array');
  assert.deepEqual([...out], [...buf]);
  const sub = Buffer.from('abcdef').subarray(2, 4);
  assert.deepEqual([...plainBytes(sub)], [99, 100]);
  assert.equal(plainBytes(new ArrayBuffer(3)).constructor.name, 'Uint8Array');
  const u = new Uint8Array([1, 2]);
  assert.equal(plainBytes(u), u);
  assert.equal(plainBytes('metin'), 'metin');
});
