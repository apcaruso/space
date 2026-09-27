import { describe, expect, it } from 'vitest';
import { delta } from '../universe/coords';
import { lookAt } from './camera';
import { Flight } from './flight';

describe('camera flights', () => {
  it('end exactly at the target', () => {
    const from = lookAt({ sx: 0, sy: 0, x: 0.5, y: 0.5 }, 12);
    const to = lookAt({ sx: 40, sy: -30, x: 0.2, y: 0.9 }, 14);
    const f = new Flight(from, to);
    let c = from;
    for (let t = 0; t < f.duration + 100; t += 16) c = f.advance(16);
    expect(f.done).toBe(true);
    expect(c).toEqual(to);
  });

  it('zoom out on the way between far points, and move monotonically', () => {
    const from = lookAt({ sx: 0, sy: 0, x: 0.5, y: 0.5 }, 12);
    const to = lookAt({ sx: 40, sy: -30, x: 0.2, y: 0.9 }, 12);
    const f = new Flight(from, to);
    let minZ = Infinity;
    let prevLeft = Infinity;
    while (!f.done) {
      const c = f.advance(16);
      minZ = Math.min(minZ, c.z);
      const [dx, dy] = delta(c.center, to.center);
      const left = Math.hypot(dx, dy);
      expect(left).toBeLessThanOrEqual(prevLeft + 1e-9);
      prevLeft = left;
    }
    // 50 sectors apart: the path rises to see both ends.
    expect(minZ).toBeLessThan(4);
  });

  it('zoom in place when the target is the same point', () => {
    const p = { sx: 3, sy: 4, x: 0.1, y: 0.2 };
    const f = new Flight(lookAt(p, 2), lookAt(p, 10));
    const mid = f.advance(f.duration / 2);
    expect(mid.z).toBeGreaterThan(2);
    expect(mid.z).toBeLessThan(10);
    expect(mid.center).toEqual(p);
  });
});
