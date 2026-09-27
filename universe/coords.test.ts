import { describe, expect, it } from 'vitest';
import { delta, fromGlobal, normalize, toGlobal } from './coords';

describe('galactic coordinates', () => {
  it('keeps offsets in [0, 1) by moving to the right sector', () => {
    expect(normalize(3, -2, 1.25, -0.5)).toEqual({ sx: 4, sy: -3, x: 0.25, y: 0.5 });
    expect(normalize(-1, 0, -2, 0.999)).toEqual({ sx: -3, sy: 0, x: 0, y: 0.999 });
  });

  it('converts to and from global coordinates', () => {
    const p = fromGlobal(-12.75, 40.5);
    expect(p).toEqual({ sx: -13, sy: 40, x: 0.25, y: 0.5 });
    expect(toGlobal(p)).toEqual([-12.75, 40.5]);
  });

  it('measures distances with the precision of the distance, not of the position', () => {
    // Far from the origin a global double would lose the 1e-9 offset; delta keeps it.
    const a = { sx: 2_000_000_000, sy: -2_000_000_000, x: 0.5, y: 0.25 };
    const b = { sx: 2_000_000_000, sy: -2_000_000_000, x: 0.5 + 1e-9, y: 0.25 };
    expect(delta(a, b)[0]).toBeCloseTo(1e-9, 15);
    expect(delta(a, { ...a, sx: a.sx + 3, x: 0.1 })).toEqual([2.6, 0]);
  });
});
