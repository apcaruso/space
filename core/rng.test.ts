import { describe, expect, it } from 'vitest';
import { derive } from './hash';
import { Rng } from './rng';

const N = 100000;

describe('Rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = new Rng(derive(7, 'test'));
    const b = new Rng(derive(7, 'test'));
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('gives different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let equal = 0;
    for (let i = 0; i < 1000; i++) if (a.next() === b.next()) equal++;
    expect(equal).toBe(0);
  });

  it('returns uint32 from next', () => {
    const r = new Rng(3);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    }
  });

  it('draws floats in [0, 1) with mean 1/2 and variance 1/12', () => {
    const r = new Rng(4);
    let sum = 0;
    let sumSq = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < N; i++) {
      const v = r.float();
      sum += v;
      sumSq += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / N;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.005);
    expect(Math.abs(sumSq / N - mean * mean - 1 / 12)).toBeLessThan(0.002);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(min).toBeLessThan(0.001);
    expect(max).toBeLessThan(1);
    expect(max).toBeGreaterThan(0.999);
  });

  it('draws integers uniformly with both bounds inclusive', () => {
    const r = new Rng(5);
    const counts = new Array<number>(10).fill(0);
    for (let i = 0; i < N; i++) counts[r.int(0, 9)]++;
    for (const c of counts) expect(Math.abs(c - N / 10)).toBeLessThan(500);

    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const v = r.int(-3, 3);
      expect(Number.isInteger(v) && v >= -3 && v <= 3).toBe(true);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
    expect(r.int(8, 8)).toBe(8);
  });

  it('draws ranges within [a, b)', () => {
    const r = new Rng(6);
    for (let i = 0; i < 10000; i++) {
      const v = r.range(-2.5, 4);
      expect(v >= -2.5 && v < 4).toBe(true);
    }
  });

  it('returns true from chance with probability p', () => {
    const r = new Rng(7);
    let hits = 0;
    for (let i = 0; i < N; i++) if (r.chance(0.3)) hits++;
    expect(Math.abs(hits / N - 0.3)).toBeLessThan(0.01);
    for (let i = 0; i < 1000; i++) {
      expect(r.chance(0)).toBe(false);
      expect(r.chance(1)).toBe(true);
    }
  });

  it('picks every element and rejects empty arrays', () => {
    const r = new Rng(8);
    const items = ['a', 'b', 'c', 'd'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(r.pick(items));
    expect(seen.size).toBe(items.length);
    expect(() => r.pick([])).toThrow(RangeError);
  });

  it('shuffles in place into a deterministic permutation', () => {
    const base = Array.from({ length: 50 }, (_, i) => i);
    const a = base.slice();
    const result = new Rng(9).shuffle(a);
    expect(result).toBe(a);
    expect(a.slice().sort((x, y) => x - y)).toEqual(base);
    expect(a).not.toEqual(base);
    expect(new Rng(9).shuffle(base.slice())).toEqual(a);
    expect(new Rng(10).shuffle(base.slice())).not.toEqual(a);
  });

  it('puts each element in each position about equally often', () => {
    const r = new Rng(11);
    const counts = new Array<number>(16).fill(0);
    const trials = 40000;
    for (let t = 0; t < trials; t++) {
      const a = r.shuffle([0, 1, 2, 3]);
      counts[a[0] * 4 + a[3]]++;
    }
    // Element i first and element j last, for i != j: probability 1/12 each.
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const c = counts[i * 4 + j];
        if (i === j) expect(c).toBe(0);
        else expect(Math.abs(c / trials - 1 / 12)).toBeLessThan(0.01);
      }
    }
  });
});
