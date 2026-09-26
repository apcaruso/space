import { describe, expect, it } from 'vitest';
import { fingerprintBytes } from './fingerprint';
import { derive, hashCoords, hashStageX, hashStageY, hashStageZ, hashString, mix32 } from './hash';

function hex(h: number): string {
  return h.toString(16).padStart(8, '0');
}

/** Number of values that repeat an earlier one (n - distinct). */
function collisions(values: Uint32Array): number {
  const sorted = values.slice().sort();
  let count = 0;
  for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) count++;
  return count;
}

// Birthday bound for 10^6 uniform uint32 values: n(n-1)/2 / 2^32 ~= 116.4, Poisson sigma ~= 10.8.
const GRID = 1000;
const EXPECTED = (GRID * GRID * (GRID * GRID - 1)) / 2 / 4294967296;
const TOLERANCE = 5 * Math.sqrt(EXPECTED);
const TWO_40 = 1099511627776;
const TWO_53 = 9007199254740992;

describe('mix32', () => {
  it('maps into uint32 and fixes zero', () => {
    expect(mix32(0)).toBe(0);
    for (const v of [1, -1, 0x7fffffff, 0xffffffff, 123456789]) {
      const h = mix32(v);
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    }
  });

  it('is injective on a range of inputs', () => {
    const out = new Uint32Array(100000);
    for (let i = 0; i < out.length; i++) out[i] = mix32(i);
    expect(collisions(out)).toBe(0);
  });

  it('flips about half of the output bits for a one-bit input change', () => {
    let flipped = 0;
    let trials = 0;
    for (let i = 0; i < 2000; i++) {
      const v = mix32(i * 7919 + 1);
      for (let bit = 0; bit < 32; bit++) {
        let d = (mix32(v) ^ mix32(v ^ (1 << bit))) >>> 0;
        while (d !== 0) {
          flipped += d & 1;
          d >>>= 1;
        }
        trials++;
      }
    }
    expect(flipped / trials).toBeGreaterThan(15.5);
    expect(flipped / trials).toBeLessThan(16.5);
  });
});

describe('hashString', () => {
  it('matches the FNV-1a 32-bit reference vectors', () => {
    expect(hex(hashString(''))).toBe('811c9dc5');
    expect(hex(hashString('a'))).toBe('e40c292c');
    expect(hex(hashString('foobar'))).toBe('bf9cf968');
  });

  it('hashes the UTF-8 bytes of non-ASCII text', () => {
    const cases: [string, number[]][] = [
      ['é', [0xc3, 0xa9]],
      ['€', [0xe2, 0x82, 0xac]],
      ['😀', [0xf0, 0x9f, 0x98, 0x80]],
      ['nébula ☄', [0x6e, 0xc3, 0xa9, 0x62, 0x75, 0x6c, 0x61, 0x20, 0xe2, 0x98, 0x84]],
    ];
    for (const [text, bytes] of cases) {
      expect(hex(hashString(text))).toBe(fingerprintBytes(new Uint8Array(bytes)));
    }
  });
});

describe('derive', () => {
  it('is deterministic and returns uint32', () => {
    for (let i = 0; i < 100; i++) {
      const a = derive(i, 'clouds', i * 3 - 50);
      expect(derive(i, 'clouds', i * 3 - 50)).toBe(a);
      expect(Number.isInteger(a) && a >= 0 && a <= 0xffffffff).toBe(true);
    }
  });

  it('returns the normalised seed with no parts', () => {
    expect(derive(42)).toBe(42);
    expect(derive(-1)).toBe(0xffffffff);
  });

  it('is hierarchical', () => {
    const s = 0xdecafbad;
    expect(derive(derive(s, 'sector', 4, -9), 'star', 2)).toBe(derive(s, 'sector', 4, -9, 'star', 2));
    expect(derive(derive(s, 'a'), 'b')).toBe(derive(s, 'a', 'b'));
  });

  it('separates names, order, types and parents', () => {
    const s = 1234;
    const seeds = [
      derive(s, 'clouds'),
      derive(s, 'rings'),
      derive(s, 'clouds', 'rings'),
      derive(s, 'rings', 'clouds'),
      derive(s, 'cloudsrings'),
      derive(s, '7'),
      derive(s, 7),
      derive(s, 1, 2),
      derive(s, 2, 1),
      derive(s, 12),
      derive(s + 1, 'clouds'),
      derive(s),
    ];
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('handles negative and large integers as 64-bit values', () => {
    const s = 99;
    expect(derive(s, -1)).not.toBe(derive(s, 0xffffffff));
    expect(derive(s, -0x80000000)).not.toBe(derive(s, 0x80000000));
    expect(derive(s, TWO_40)).not.toBe(derive(s, TWO_40 + 1));
    expect(derive(s, TWO_40)).not.toBe(derive(s, 0));
    expect(derive(s, -0)).toBe(derive(s, 0));
    expect(derive(s, Number.MAX_SAFE_INTEGER)).not.toBe(derive(s, Number.MIN_SAFE_INTEGER));
  });

  it('rejects numbers that are not safe integers', () => {
    expect(() => derive(1, 1.5)).toThrow(RangeError);
    expect(() => derive(1, NaN)).toThrow(RangeError);
    expect(() => derive(1, Infinity)).toThrow(RangeError);
    expect(() => derive(1, TWO_53)).toThrow(RangeError);
  });

  it('collides on a 1000x1000 sector grid only as often as random 32-bit values', () => {
    const out = new Uint32Array(GRID * GRID);
    let i = 0;
    for (let y = -GRID / 2; y < GRID / 2; y++) {
      for (let x = -GRID / 2; x < GRID / 2; x++) out[i++] = derive(0x5eed, 'sector', x, y);
    }
    const c = collisions(out);
    expect(c).toBeGreaterThan(EXPECTED - TOLERANCE);
    expect(c).toBeLessThan(EXPECTED + TOLERANCE);
  });
});

describe('hashCoords', () => {
  it('is deterministic, and 2D equals z = 0', () => {
    expect(hashCoords(5, 10, -20, 30)).toBe(hashCoords(5, 10, -20, 30));
    expect(hashCoords(5, 10, -20)).toBe(hashCoords(5, 10, -20, 0));
    expect(hashCoords(5, 10, -20)).not.toBe(hashCoords(6, 10, -20));
    expect(hashCoords(5, 10, -20, 1)).not.toBe(hashCoords(5, 10, -20, 0));
  });

  it('equals the composition of its stages', () => {
    for (let i = -200; i < 200; i++) {
      const [x, y, z] = [i * 7, -i * 13 + 5, i * i];
      expect(hashStageZ(hashStageY(hashStageX(9, x), y), z)).toBe(hashCoords(9, x, y, z));
      expect(hashStageZ(hashStageY(hashStageX(9, x), y), 0)).toBe(hashCoords(9, x, y));
    }
  });

  it('distinguishes swapped coordinates', () => {
    let same = 0;
    for (let a = -50; a < 50; a++) {
      for (let b = -50; b < 50; b++) if (a !== b && hashCoords(3, a, b) === hashCoords(3, b, a)) same++;
    }
    expect(same).toBe(0);
  });

  it('sets every output bit about half of the time over a lattice', () => {
    const ones = new Array<number>(32).fill(0);
    const n = 256 * 256;
    for (let y = -128; y < 128; y++) {
      for (let x = -128; x < 128; x++) {
        const h = hashCoords(77, x, y, 3);
        for (let bit = 0; bit < 32; bit++) ones[bit] += (h >>> bit) & 1;
      }
    }
    for (const count of ones) {
      expect(Math.abs(count / n - 0.5)).toBeLessThan(0.01);
    }
  });

  it('collides on a 1000x1000 lattice only as often as random 32-bit values', () => {
    const out = new Uint32Array(GRID * GRID);
    let i = 0;
    for (let y = -GRID / 2; y < GRID / 2; y++) {
      for (let x = -GRID / 2; x < GRID / 2; x++) out[i++] = hashCoords(0x5eed, x, y);
    }
    const c = collisions(out);
    expect(c).toBeGreaterThan(EXPECTED - TOLERANCE);
    expect(c).toBeLessThan(EXPECTED + TOLERANCE);
  });
});
