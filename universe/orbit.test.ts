import { describe, expect, it } from 'vitest';
import { derive } from '../core/hash';
import { Rng } from '../core/rng';
import { orbitPosition, periodTicks, solveKepler, TICKS_PER_YEAR, type Orbit } from './orbit';

describe('orbits on rails', () => {
  it('solves Kepler\'s equation to machine precision for every eccentricity', () => {
    const rng = new Rng(derive(1, 'kepler'));
    for (let i = 0; i < 2000; i++) {
      const e = i < 1000 ? rng.float() * 0.95 : 0.95 + rng.float() * 0.04;
      const M = rng.float() * 2 * Math.PI;
      const E = solveKepler(M, e);
      expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(1e-9);
    }
  });

  it('is periodic in integer ticks and exact far in the future', () => {
    const o: Orbit = { a: 2.5, e: 0.3, omega: 1.1, period: 9731, phase: 1234 };
    for (const t of [0, 17, 5000, -42]) {
      const p = orbitPosition(o, t);
      const q = orbitPosition(o, t + 7 * o.period);
      const far = orbitPosition(o, t + 1_000_000 * o.period);
      expect(q).toEqual(p);
      expect(far).toEqual(p);
    }
  });

  it('puts periapsis and apoapsis at the right distances', () => {
    const o: Orbit = { a: 4, e: 0.5, omega: 0, period: 100, phase: 0 };
    const peri = orbitPosition(o, 0);
    const apo = orbitPosition(o, 50);
    expect(Math.hypot(peri.x, peri.y)).toBeCloseTo(2, 12);
    expect(Math.hypot(apo.x, apo.y)).toBeCloseTo(6, 12);
    // A circle stays at radius a.
    const c: Orbit = { a: 3, e: 0, omega: 0.7, period: 64, phase: 5 };
    for (let t = 0; t < 64; t += 7) {
      const p = orbitPosition(c, t);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(3, 12);
    }
  });

  it('follows Kepler\'s third law', () => {
    expect(periodTicks(1, 1)).toBe(TICKS_PER_YEAR);
    expect(periodTicks(4, 1)).toBe(8 * TICKS_PER_YEAR);
    expect(periodTicks(1, 4)).toBe(TICKS_PER_YEAR / 2);
  });
});
