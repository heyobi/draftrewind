// isomorphic-git genel (global) bir Buffer bekler; React Native/Hermes'te yoktur.
// Motorun ilk içe aktardığı dosyadır.
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
