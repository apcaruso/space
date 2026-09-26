import { describe, expect, it } from 'vitest';
import { BAYER2, BAYER4, BAYER8, bayerThreshold, ditherQuantize, type BayerMatrix } from './dither';

const ranks = (m: BayerMatrix) => [...m.thresholds].map((t) => t * m.size * m.size - 0.5);

describe('Bayer matrices', () => {
  it('match the classic 2x2 and 4x4 matrices', () => {
    expect(ranks(BAYER2)).toEqual([0, 2, 3, 1]);
    expect(ranks(BAYER4)).toEqual([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
  });

  it('are permutations of all ranks, with thresholds averaging 1/2', () => {
    for (const m of [BAYER2, BAYER4, BAYER8]) {
      const r = ranks(m).sort((a, b) => a - b);
      expect(r).toEqual(Array.from({ length: m.size * m.size }, (_, i) => i));
      const mean = [...m.thresholds].reduce((a, b) => a + b, 0) / m.thresholds.length;
      expect(mean).toBeCloseTo(0.5, 12);
    }
  });

  it('tile in object coordinates, negative ones included', () => {
    for (let y = -9; y < 9; y++) {
      for (let x = -9; x < 9; x++) {
        const t = bayerThreshold(BAYER4, x, y);
        expect(bayerThreshold(BAYER4, x + 4, y)).toBe(t);
        expect(bayerThreshold(BAYER4, x, y - 8)).toBe(t);
        expect(t).toBe(bayerThreshold(BAYER4, x, y));
      }
    }
    expect(bayerThreshold(BAYER4, -1, -1)).toBe(bayerThreshold(BAYER4, 3, 3));
  });
});

describe('ditherQuantize', () => {
  it('gives hard bands at integer boundaries without dither', () => {
    expect(ditherQuantize(0.99, 0.5)).toBe(0);
    expect(ditherQuantize(1, 0.5)).toBe(1);
    expect(ditherQuantize(2.5, 0.5)).toBe(2);
  });

  it('covers a tile with the upper level in proportion to the position between band centres', () => {
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const v = 1.5 + f; // from the centre of band 1 to the centre of band 2
      let upper = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) upper += ditherQuantize(v, bayerThreshold(BAYER8, x, y)) === 2 ? 1 : 0;
      expect(upper / 64).toBeCloseTo(f, 1);
    }
  });

  it('dithers only within the band width around a boundary', () => {
    const levels = (v: number, width: number) => {
      const seen = new Set<number>();
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(ditherQuantize(v, bayerThreshold(BAYER4, x, y), width));
      return [...seen].sort();
    };
    expect(levels(1.8, 0.3)).toEqual([1]);
    expect(levels(1.9, 0.3)).toEqual([1, 2]);
    expect(levels(2.1, 0.3)).toEqual([1, 2]);
    expect(levels(2.2, 0.3)).toEqual([2]);
    expect(levels(1.9, 0)).toEqual([1]);
    expect(levels(2, 0)).toEqual([2]);
  });

  it('is deterministic', () => {
    const run = () => Array.from({ length: 64 }, (_, i) => ditherQuantize(i / 13, bayerThreshold(BAYER8, i, i * 3), 0.6));
    expect(run()).toEqual(run());
  });
});
