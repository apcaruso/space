import { describe, expect, it } from 'vitest';
import { derive, hashCoords, mix32 } from './hash';
import {
  createCellSample,
  Fbm2,
  Fbm3,
  gradientNoise2,
  gradientNoise3,
  valueNoise2,
  valueNoise3,
  Warp2,
  Warp3,
  worley2,
  worley3,
  type CellSample,
  type Field3,
  type Noise3,
} from './noise';
import { Rng } from './rng';

const SEED = derive(0x5eed, 'noise-test');
const N = 100000;

// Every noise as a 3D function, so one set of checks covers all of them.
const NOISES: [string, Noise3][] = [
  ['valueNoise2', (s, x, y) => valueNoise2(s, x, y)],
  ['valueNoise3', valueNoise3],
  ['gradientNoise2', (s, x, y) => gradientNoise2(s, x, y)],
  ['gradientNoise3', gradientNoise3],
];

function stats(f: (x: number, y: number, z: number) => number, seed: number, n = N, spread = 1000) {
  const r = new Rng(seed);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = f(r.range(-spread, spread), r.range(-spread, spread), r.range(-spread, spread));
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / n };
}

/** Largest |f(p + e) - f(p)| / |e| over random points and directions, with |e| = eps. */
function maxSlope(f: (x: number, y: number, z: number) => number, seed: number, eps = 1e-4, n = 20000): number {
  const r = new Rng(seed);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const x = r.range(-100, 100);
    const y = r.range(-100, 100);
    const z = r.range(-100, 100);
    let dx = r.range(-1, 1);
    let dy = r.range(-1, 1);
    let dz = r.range(-1, 1);
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx = (dx / len) * eps;
    dy = (dy / len) * eps;
    dz = (dz / len) * eps;
    const slope = Math.abs(f(x + dx, y + dy, z + dz) - f(x, y, z)) / eps;
    if (slope > worst) worst = slope;
  }
  return worst;
}

describe('value and gradient noise', () => {
  for (const [name, noise] of NOISES) {
    describe(name, () => {
      it('is deterministic and depends on the seed', () => {
        const r = new Rng(1);
        let differs = 0;
        for (let i = 0; i < 1000; i++) {
          const x = r.range(-50, 50);
          const y = r.range(-50, 50);
          const z = r.range(-50, 50);
          expect(noise(SEED, x, y, z)).toBe(noise(SEED, x, y, z));
          if (noise(SEED, x, y, z) !== noise(SEED + 1, x, y, z)) differs++;
        }
        expect(differs).toBeGreaterThan(990);
      });

      it('stays in [-1, 1], centred on 0, and uses most of the range', () => {
        const s = stats((x, y, z) => noise(SEED, x, y, z), 2);
        expect(s.min).toBeGreaterThanOrEqual(-1);
        expect(s.max).toBeLessThanOrEqual(1);
        expect(Math.abs(s.mean)).toBeLessThan(0.02);
        expect(s.min).toBeLessThan(-0.6);
        expect(s.max).toBeGreaterThan(0.6);
      });

      it('is continuous: nearby samples have nearby values', () => {
        expect(maxSlope((x, y, z) => noise(SEED, x, y, z), 3)).toBeLessThan(10);
      });
    });
  }

  it('makes gradient noise zero on lattice points', () => {
    for (const [x, y, z] of [[0, 0, 0], [3, -7, 12], [-100, 55, -1]]) {
      expect(Math.abs(gradientNoise3(SEED, x, y, z))).toBe(0);
      expect(Math.abs(gradientNoise2(SEED, x, y))).toBe(0);
    }
  });

  it('makes value noise equal the lattice hash on lattice points', () => {
    expect(valueNoise3(SEED, 4, -9, 2)).toBe(hashCoords(SEED, 4, -9, 2) * (2 / 4294967296) - 1);
    expect(valueNoise2(SEED, -31, 8)).toBe(hashCoords(SEED, -31, 8) * (2 / 4294967296) - 1);
  });
});

describe('fbm', () => {
  const fbm3 = new Fbm3(gradientNoise3, SEED, { octaves: 5 });
  const fbm2 = new Fbm2(valueNoise2, SEED, { octaves: 4, lacunarity: 2.2, gain: 0.45, frequency: 0.5 });

  it('is deterministic', () => {
    expect(fbm3.sample(1.25, -3.5, 7)).toBe(new Fbm3(gradientNoise3, SEED, { octaves: 5 }).sample(1.25, -3.5, 7));
    expect(fbm2.sample(10.5, 3.25)).toBe(fbm2.sample(10.5, 3.25));
  });

  it('keeps the base range and centre', () => {
    const s3 = stats((x, y, z) => fbm3.sample(x, y, z), 4, 50000);
    expect(s3.min).toBeGreaterThanOrEqual(-1);
    expect(s3.max).toBeLessThanOrEqual(1);
    expect(Math.abs(s3.mean)).toBeLessThan(0.02);
    const s2 = stats((x, y) => fbm2.sample(x, y), 5, 50000);
    expect(s2.min).toBeGreaterThanOrEqual(-1);
    expect(s2.max).toBeLessThanOrEqual(1);
    expect(Math.abs(s2.mean)).toBeLessThan(0.02);
  });

  it('is not pinned to zero at the origin', () => {
    expect(Math.abs(fbm3.sample(0, 0, 0))).toBeGreaterThan(0);
  });

  it('is continuous', () => {
    expect(maxSlope((x, y, z) => fbm3.sample(x, y, z), 6)).toBeLessThan(30);
  });

  it('depends on the seed and on the octave count', () => {
    const other = new Fbm3(gradientNoise3, SEED + 1, { octaves: 5 });
    const fewer = new Fbm3(gradientNoise3, SEED, { octaves: 4 });
    expect(other.sample(1.5, 2.5, 3.5)).not.toBe(fbm3.sample(1.5, 2.5, 3.5));
    expect(fewer.sample(1.5, 2.5, 3.5)).not.toBe(fbm3.sample(1.5, 2.5, 3.5));
  });

  it('rejects invalid octave counts', () => {
    expect(() => new Fbm3(gradientNoise3, SEED, { octaves: 0 })).toThrow(RangeError);
    expect(() => new Fbm2(valueNoise2, SEED, { octaves: 2.5 })).toThrow(RangeError);
  });
});

describe('domain warp', () => {
  const source = new Fbm3(gradientNoise3, derive(SEED, 'source'), { octaves: 3 });

  it('equals the source with zero amplitude', () => {
    const still = new Warp3(source, SEED, { amplitude: 0 });
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = r.range(-20, 20);
      const y = r.range(-20, 20);
      const z = r.range(-20, 20);
      expect(still.sample(x, y, z)).toBe(source.sample(x, y, z));
    }
  });

  it('moves the samples, keeps the range, and composes', () => {
    const warp: Field3 = new Warp3(source, SEED, { amplitude: 2, octaves: 3 });
    const twice: Field3 = new Warp3(warp, derive(SEED, 'again'), { amplitude: 1, octaves: 2 });
    let moved = 0;
    const r = new Rng(8);
    for (let i = 0; i < 2000; i++) {
      const x = r.range(-20, 20);
      const y = r.range(-20, 20);
      const z = r.range(-20, 20);
      const v = warp.sample(x, y, z);
      const w = twice.sample(x, y, z);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(w)).toBeLessThanOrEqual(1);
      if (v !== source.sample(x, y, z)) moved++;
    }
    expect(moved).toBeGreaterThan(1990);
  });

  it('is continuous', () => {
    const warp = new Warp3(source, SEED, { amplitude: 1, octaves: 3 });
    expect(maxSlope((x, y, z) => warp.sample(x, y, z), 9)).toBeLessThan(60);
    const warp2 = new Warp2(new Fbm2(gradientNoise2, SEED), SEED, { amplitude: 1, octaves: 3 });
    expect(maxSlope((x, y) => warp2.sample(x, y), 10)).toBeLessThan(60);
  });
});

// Exhaustive reference over a window wider than the one worley2/worley3 search.
function bruteWorley2(seed: number, x: number, y: number, jitter: number, out: CellSample): CellSample {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  let d1 = Infinity;
  let d2 = Infinity;
  let best = 0;
  for (let oy = -4; oy <= 4; oy++) {
    for (let ox = -4; ox <= 4; ox++) {
      const h = hashCoords(seed, xi + ox, yi + oy);
      const dx = ox + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5) - fx;
      const dy = oy + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5) - fy;
      const dd = dx * dx + dy * dy;
      if (dd < d1) {
        d2 = d1;
        d1 = dd;
        best = h;
      } else if (dd < d2) {
        d2 = dd;
      }
    }
  }
  out.f1 = Math.sqrt(d1);
  out.f2 = Math.sqrt(d2);
  out.cell = mix32(best ^ 0x632be5ab);
  return out;
}

function bruteWorley3(seed: number, x: number, y: number, z: number, jitter: number, out: CellSample): CellSample {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  let d1 = Infinity;
  let d2 = Infinity;
  let best = 0;
  for (let oz = -4; oz <= 4; oz++) {
    for (let oy = -4; oy <= 4; oy++) {
      for (let ox = -4; ox <= 4; ox++) {
        const h = hashCoords(seed, xi + ox, yi + oy, zi + oz);
        const h2 = mix32(h ^ 0x5bd1e995);
        const dx = ox + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5) - fx;
        const dy = oy + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5) - fy;
        const dz = oz + 0.5 + jitter * ((h2 & 0xffff) / 65536 - 0.5) - fz;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < d1) {
          d2 = d1;
          d1 = dd;
          best = h;
        } else if (dd < d2) {
          d2 = dd;
        }
      }
    }
  }
  out.f1 = Math.sqrt(d1);
  out.f2 = Math.sqrt(d2);
  out.cell = mix32(best ^ 0x632be5ab);
  return out;
}

describe('worley', () => {
  const a = createCellSample();
  const b = createCellSample();

  it('matches an exhaustive search exactly', () => {
    const r = new Rng(11);
    for (const jitter of [1, 0.75, 0.3, 0]) {
      for (let i = 0; i < 3000; i++) {
        const x = r.range(-500, 500);
        const y = r.range(-500, 500);
        const z = r.range(-500, 500);
        worley2(SEED, x, y, a, jitter);
        bruteWorley2(SEED, x, y, jitter, b);
        expect(a).toEqual(b);
        if (i % 3 === 0) {
          worley3(SEED, x, y, z, a, jitter);
          bruteWorley3(SEED, x, y, z, jitter, b);
          expect(a).toEqual(b);
        }
      }
    }
  });

  it('is deterministic and writes into the given sample', () => {
    const out = worley3(SEED, 1.5, 2.5, 3.5, a);
    expect(out).toBe(a);
    const copy = { ...a };
    expect(worley3(SEED, 1.5, 2.5, 3.5, b)).toEqual(copy);
  });

  it('keeps F1 <= F2 within the documented bounds', () => {
    const r = new Rng(12);
    let min1 = Infinity;
    let max1 = 0;
    for (let i = 0; i < 50000; i++) {
      const x = r.range(-1000, 1000);
      const y = r.range(-1000, 1000);
      const z = r.range(-1000, 1000);
      worley2(SEED, x, y, a);
      expect(a.f1).toBeLessThanOrEqual(a.f2);
      expect(a.f1).toBeLessThanOrEqual(Math.SQRT2);
      expect(a.f2).toBeLessThanOrEqual(Math.sqrt(5));
      worley3(SEED, x, y, z, b);
      expect(b.f1).toBeLessThanOrEqual(b.f2);
      expect(b.f1).toBeLessThanOrEqual(Math.sqrt(3));
      expect(b.f2).toBeLessThanOrEqual(Math.sqrt(6));
      min1 = Math.min(min1, a.f1);
      max1 = Math.max(max1, a.f1);
    }
    expect(min1).toBeLessThan(0.05);
    expect(max1).toBeGreaterThan(0.8);
  });

  it('is 1-Lipschitz in F1 and F2', () => {
    const f1 = (x: number, y: number, z: number) => worley3(SEED, x, y, z, a).f1;
    const f2 = (x: number, y: number, z: number) => worley3(SEED, x, y, z, a).f2;
    const g1 = (x: number, y: number) => worley2(SEED, x, y, a).f1;
    const g2 = (x: number, y: number) => worley2(SEED, x, y, a).f2;
    for (const f of [f1, f2, g1, g2]) expect(maxSlope(f, 13, 1e-3, 10000)).toBeLessThan(1 + 1e-6);
  });

  it('keeps the cell id inside a cell and changes it across cells', () => {
    const r = new Rng(14);
    let changed = 0;
    for (let i = 0; i < 5000; i++) {
      const x = r.range(-100, 100);
      const y = r.range(-100, 100);
      worley2(SEED, x, y, a);
      if (a.f2 - a.f1 > 0.01) {
        const id = a.cell;
        expect(worley2(SEED, x + 0.001, y - 0.001, b).cell).toBe(id);
      }
      if (worley2(SEED, x + 3, y, b).cell !== a.cell) changed++;
    }
    expect(changed).toBeGreaterThan(4990);
  });
});
