import { describe, expect, it } from 'vitest';
import { FloatField, IndexedBuffer } from './buffer';
import { fingerprint, fingerprintBytes } from './fingerprint';

describe('fingerprintBytes', () => {
  it('matches the FNV-1a 32-bit reference vectors', () => {
    expect(fingerprintBytes(new Uint8Array())).toBe('811c9dc5');
    expect(fingerprintBytes(new Uint8Array([0x61]))).toBe('e40c292c');
    expect(fingerprintBytes(new Uint8Array([0x66, 0x6f, 0x6f, 0x62, 0x61, 0x72]))).toBe('bf9cf968');
  });
});

describe('fingerprint', () => {
  it('is 8 hex digits and stable for equal contents', () => {
    const a = new IndexedBuffer(4, 4).fill(3);
    const b = new IndexedBuffer(4, 4).fill(3);
    expect(fingerprint(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('changes when a single pixel changes', () => {
    const a = new IndexedBuffer(16, 16);
    const before = fingerprint(a);
    a.set(15, 15, 1);
    expect(fingerprint(a)).not.toBe(before);
  });

  it('distinguishes shapes and kinds with the same bytes', () => {
    expect(fingerprint(new IndexedBuffer(4, 2))).not.toBe(fingerprint(new IndexedBuffer(2, 4)));
    expect(fingerprint(new IndexedBuffer(2, 2))).not.toBe(fingerprint(new FloatField(2, 2)));
  });

  it('hashes float fields by their float32 bits', () => {
    const a = new FloatField(2, 1);
    a.set(0, 0, 0.1);
    const b = new FloatField(2, 1);
    b.set(0, 0, Math.fround(0.1));
    expect(fingerprint(a)).toBe(fingerprint(b));
    b.set(0, 0, 0.1000001);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('respects the view of a float field built on a larger buffer', () => {
    const backing = new Float32Array([9, 1, 2, 9]);
    const view = new FloatField(2, 1, backing.subarray(1, 3));
    expect(fingerprint(view)).toBe(fingerprint(new FloatField(2, 1, new Float32Array([1, 2]))));
  });
});
