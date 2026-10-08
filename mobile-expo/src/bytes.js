// expo-file-system yazılacak verinin türünü `constructor.name` ile tanır ve tanımadığı adda
// (ör. Buffer — isomorphic-git'in verdiği Uint8Array alt sınıfı) yerel kodda uygulamayı çökertir;
// JS try/catch bunu yakalayamaz. Her ikili yazımdan önce düz bir Uint8Array'e çeviririz (kopyasız).
export function plainBytes(b) {
  if (typeof b === 'string') return b;
  if (b instanceof ArrayBuffer) return new Uint8Array(b);
  if (ArrayBuffer.isView(b)) {
    if (b.constructor === Uint8Array) return b;
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  return new Uint8Array(b);
}
