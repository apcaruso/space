import { describe, expect, it } from 'vitest';
import * as d from './dmath';
import { Rng } from './rng';

// Math.* is the reference here (allowed in tests). Error is absolute for |ref| <= 1 and relative
// above, so large results (exp, pow, tan) are judged on their significant digits.
const TARGET = 1e-7;

function maxError(
  f: (x: number) => number,
  ref: (x: number) => number,
  gen: (r: Rng) => number,
  seed: number,
  n = 50000,
): number {
  const r = new Rng(seed);
  let worst = 0;
  for (let i = 0; i < n; i++) {
    const x = gen(r);
    const a = f(x);
    const b = ref(x);
    const err = Math.abs(a - b) / Math.max(1, Math.abs(b));
    if (!(err <= worst)) worst = err;
  }
  return worst;
}

describe('dmath constants', () => {
  it('match Math', () => {
    expect(d.PI).toBe(Math.PI);
    expect(d.TAU).toBe(2 * Math.PI);
    expect(d.HALF_PI).toBe(Math.PI / 2);
    expect(d.E).toBe(Math.E);
    expect(d.LN2).toBe(Math.LN2);
    expect(d.LN10).toBe(Math.LN10);
    expect(d.SQRT2).toBe(Math.SQRT2);
    expect(d.SQRT1_2).toBe(Math.SQRT1_2);
  });
});

describe('dmath accuracy against Math', () => {
  it('sin and cos', () => {
    expect(maxError(d.sin, Math.sin, (r) => r.range(-10, 10), 1)).toBeLessThan(TARGET);
    expect(maxError(d.sin, Math.sin, (r) => r.range(-1000, 1000), 2)).toBeLessThan(TARGET);
    expect(maxError(d.sin, Math.sin, (r) => r.range(-1e6, 1e6), 3, 20000)).toBeLessThan(TARGET);
    expect(maxError(d.cos, Math.cos, (r) => r.range(-10, 10), 4)).toBeLessThan(TARGET);
    expect(maxError(d.cos, Math.cos, (r) => r.range(-1000, 1000), 5)).toBeLessThan(TARGET);
    expect(maxError(d.cos, Math.cos, (r) => r.range(-1e6, 1e6), 6, 20000)).toBeLessThan(TARGET);
  });

  it('tan', () => {
    expect(maxError(d.tan, Math.tan, (r) => r.range(-20, 20), 7)).toBeLessThan(TARGET);
  });

  it('atan, asin, acos', () => {
    expect(maxError(d.atan, Math.atan, (r) => r.range(-3, 3), 8)).toBeLessThan(TARGET);
    expect(maxError(d.atan, Math.atan, (r) => r.range(-1e4, 1e4), 9)).toBeLessThan(TARGET);
    expect(maxError(d.asin, Math.asin, (r) => r.range(-1, 1), 10)).toBeLessThan(TARGET);
    expect(maxError(d.acos, Math.acos, (r) => r.range(-1, 1), 11)).toBeLessThan(TARGET);
  });

  it('atan2 in all quadrants', () => {
    const r = new Rng(12);
    let worst = 0;
    for (let i = 0; i < 50000; i++) {
      const y = r.range(-100, 100);
      const x = r.range(-100, 100);
      worst = Math.max(worst, Math.abs(d.atan2(y, x) - Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(TARGET);
    for (const [y, x] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1e-300, -1], [5, 1e-300]]) {
      expect(Math.abs(d.atan2(y, x) - Math.atan2(y, x))).toBeLessThan(TARGET);
    }
  });

  it('exp', () => {
    expect(maxError(d.exp, Math.exp, (r) => r.range(-5, 5), 13)).toBeLessThan(TARGET);
    expect(maxError(d.exp, Math.exp, (r) => r.range(-740, 709), 14)).toBeLessThan(TARGET);
  });

  it('log', () => {
    expect(maxError(d.log, Math.log, (r) => r.range(0, 10), 15)).toBeLessThan(TARGET);
    expect(maxError(d.log, Math.log, (r) => Math.exp(r.range(-740, 709)), 16)).toBeLessThan(TARGET);
    expect(maxError(d.log, Math.log, (r) => 1 + r.range(-1e-3, 1e-3), 17)).toBeLessThan(TARGET);
  });

  it('cbrt', () => {
    expect(maxError(d.cbrt, Math.cbrt, (r) => r.range(-10, 10), 19)).toBeLessThan(TARGET);
    expect(maxError(d.cbrt, Math.cbrt, (r) => Math.exp(r.range(-700, 700)), 20)).toBeLessThan(TARGET);
    expect(maxError(d.cbrt, Math.cbrt, (r) => -Math.exp(r.range(-700, 700)), 21)).toBeLessThan(TARGET);
    expect(d.cbrt(27)).toBe(3);
    expect(d.cbrt(-8)).toBe(-2);
    expect(d.cbrt(0)).toBe(0);
  });

  it('pow', () => {
    const r = new Rng(18);
    let worst = 0;
    for (let i = 0; i < 50000; i++) {
      const x = r.range(0, 100);
      const y = r.range(-20, 20);
      const ref = Math.pow(x, y);
      if (!Number.isFinite(ref) || ref === 0) continue;
      worst = Math.max(worst, Math.abs(d.pow(x, y) - ref) / Math.max(1, Math.abs(ref)));
    }
    expect(worst).toBeLessThan(TARGET);
    for (let x = -5; x <= 5; x += 0.25) {
      for (let n = -12; n <= 12; n++) {
        const ref = Math.pow(x, n);
        if (!Number.isFinite(ref)) {
          expect(d.pow(x, n)).toBe(ref);
          continue;
        }
        const err = Math.abs(d.pow(x, n) - ref) / Math.max(1, Math.abs(ref));
        expect(err).toBeLessThan(TARGET);
      }
    }
  });
});

describe('dmath special values', () => {
  it('handles exact and limit cases', () => {
    expect(d.sin(0)).toBe(0);
    expect(d.cos(0)).toBe(1);
    expect(d.tan(0)).toBe(0);
    expect(d.exp(0)).toBe(1);
    expect(d.log(1)).toBe(0);
    expect(d.pow(2, 10)).toBe(1024);
    expect(d.pow(-2, 3)).toBe(-8);
    expect(d.pow(7.5, 0)).toBe(1);
    expect(d.pow(0, 2)).toBe(0);
    expect(d.pow(0, -1)).toBe(Infinity);
    expect(d.asin(1)).toBe(d.HALF_PI);
    expect(d.asin(-1)).toBe(-d.HALF_PI);
    expect(d.acos(1)).toBe(0);
    expect(d.acos(-1)).toBe(d.PI);
    expect(d.atan(Infinity)).toBe(d.HALF_PI);
    expect(d.atan2(0, 0)).toBe(0);
    expect(d.exp(1000)).toBe(Infinity);
    expect(d.exp(-1000)).toBe(0);
    expect(d.log(0)).toBe(-Infinity);
    expect(d.log(Infinity)).toBe(Infinity);
    expect(Math.abs(d.log(5e-324) + 744.4400719213812)).toBeLessThan(1e-12);
    expect(d.hypot(3, 4)).toBe(5);
  });

  it('returns NaN outside the domain', () => {
    expect(d.sin(NaN)).toBeNaN();
    expect(d.sin(Infinity)).toBeNaN();
    expect(d.cos(-Infinity)).toBeNaN();
    expect(d.asin(1.5)).toBeNaN();
    expect(d.acos(-1.5)).toBeNaN();
    expect(d.log(-1)).toBeNaN();
    expect(d.exp(NaN)).toBeNaN();
    expect(d.pow(-2, 0.5)).toBeNaN();
    expect(d.atan2(NaN, 1)).toBeNaN();
  });
});
