import { FloatField, IndexedBuffer } from './buffer';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function feedUint32(h: number, v: number): number {
  h = Math.imul(h ^ (v & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((v >>> 8) & 0xff), FNV_PRIME);
  h = Math.imul(h ^ ((v >>> 16) & 0xff), FNV_PRIME);
  return Math.imul(h ^ (v >>> 24), FNV_PRIME);
}

function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** FNV-1a 32-bit of raw bytes, as 8 hex digits. */
export function fingerprintBytes(bytes: Uint8Array): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], FNV_PRIME);
  return hex(h);
}

/**
 * FNV-1a 32-bit of a buffer, as 8 hex digits. Covers kind, size and contents, so equal bytes
 * with different shapes differ. Float fields are hashed as little-endian float32 bit patterns
 * on every platform.
 */
export function fingerprint(buf: IndexedBuffer | FloatField): string {
  let h = FNV_OFFSET;
  h = feedUint32(h, buf instanceof FloatField ? 2 : 1);
  h = feedUint32(h, buf.w);
  h = feedUint32(h, buf.h);
  if (buf instanceof IndexedBuffer) {
    const d = buf.data;
    for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], FNV_PRIME);
  } else {
    const d = buf.data;
    const words = new Uint32Array(d.buffer, d.byteOffset, d.length);
    for (let i = 0; i < words.length; i++) h = feedUint32(h, words[i]);
  }
  return hex(h);
}
