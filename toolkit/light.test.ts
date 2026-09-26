import { describe, expect, it } from 'vitest';
import { direction, lightLevel, lightValue, quantizeLevel } from './light';

const UP = direction(0, 0, 1);

describe('direction', () => {
  it('normalises and rejects the zero vector', () => {
    const d = direction(3, 0, 4);
    expect([d.x, d.y, d.z]).toEqual([0.6, 0, 0.8]);
    expect(() => direction(0, 0, 0)).toThrow(RangeError);
  });
});

describe('light levels', () => {
  const opts = { levels: 4 };

  it('gives the top level facing the light and the ambient level facing away', () => {
    expect(lightLevel(0, 0, 1, UP, opts)).toBe(3);
    expect(lightLevel(0, 0, -1, UP, opts)).toBe(0);
    expect(lightLevel(0, 0, -1, UP, { levels: 4, ambient: 1 })).toBe(1);
    expect(lightLevel(1, 0, 0, UP, opts)).toBe(0);
  });

  it('splits the lit side into equal bands of n·l', () => {
    const counts = [0, 0, 0, 0];
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) / n;
      const s = Math.sqrt(1 - c * c);
      counts[lightLevel(s, 0, c, UP, opts)]++;
    }
    for (const count of counts) expect(Math.abs(count - n / 4)).toBeLessThanOrEqual(1);
  });

  it('moves the terminator', () => {
    expect(lightLevel(0.8, 0, 0.6, UP, { levels: 4, terminator: 0.7 })).toBe(0);
    expect(lightLevel(0.6, 0, 0.8, UP, { levels: 4, terminator: 0.7 })).toBe(1);
  });

  it('keeps emissive materials above their minimum level', () => {
    expect(lightLevel(0, 0, -1, UP, { levels: 4, minLevel: 2 })).toBe(2);
    expect(lightLevel(0, 0, 1, UP, { levels: 4, minLevel: 2 })).toBe(3);
  });

  it('never dithers the shadow side', () => {
    const v = lightValue(0, 0, -1, UP, { levels: 4, ambient: 1 });
    for (const t of [0.01, 0.5, 0.99]) expect(quantizeLevel(v, { levels: 4, ambient: 1 }, t)).toBe(1);
  });

  it('clamps dithered levels to the valid range', () => {
    expect(quantizeLevel(4, opts, 0.99)).toBe(3);
    expect(quantizeLevel(0, opts, 0.01)).toBe(0);
  });
});
