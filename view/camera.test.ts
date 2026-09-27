import { describe, expect, it } from 'vitest';
import { lookAt, pan, Projection, SCREEN_H, SCREEN_W, zoomAt, Z_MAX, Z_MIN } from './camera';

const cam = lookAt({ sx: -12, sy: 40, x: 0.25, y: 0.5 }, 10);

describe('camera', () => {
  it('projects the centre to the middle of the screen and back', () => {
    const p = new Projection(cam);
    expect(p.px(-12, 0.25)).toBe(SCREEN_W / 2);
    expect(p.py(40, 0.5)).toBe(SCREEN_H / 2);
    const w = p.toWorld(SCREEN_W / 2, SCREEN_H / 2);
    expect(w.sx).toBe(-12);
    expect(Math.abs(w.x - 0.25)).toBeLessThan(1 / p.s);
    expect(p.px(w.sx, w.x)).toBe(SCREEN_W / 2);
  });

  it('keeps the point under the cursor fixed while zooming (within the pixel anchoring)', () => {
    const p0 = new Projection(cam);
    const under = p0.toWorld(100, 60);
    for (const dz of [0.3, -1.7, 5]) {
      const p1 = new Projection(zoomAt(cam, 100, 60, dz));
      expect(Math.abs(p1.x(under.sx, under.x) - 100.5)).toBeLessThan(1);
      expect(Math.abs(p1.y(under.sy, under.y) - 60.5)).toBeLessThan(1);
    }
    expect(zoomAt(cam, 0, 0, 100).z).toBe(Z_MAX);
    expect(zoomAt(cam, 0, 0, -100).z).toBe(Z_MIN);
  });

  it('anchors pixels to the world: a pan moves everything by the same whole pixels', () => {
    const points = [
      [-12, 0.2512345],
      [-12, 0.2598765],
      [-11, 0.0001],
      [-13, 0.99],
    ] as const;
    let prev = new Projection(cam);
    let c = cam;
    for (let step = 0; step < 50; step++) {
      c = pan(c, 0.37, 0);
      const next = new Projection(c);
      const shifts = points.map(([sx, x]) => next.px(sx, x) - prev.px(sx, x));
      expect(new Set(shifts).size).toBe(1);
      prev = next;
    }
  });

  it('stays precise deep inside a system far from the galactic centre', () => {
    const deep = lookAt({ sx: 250, sy: -180, x: 0.123456789, y: 0.5 }, 21);
    const p = new Projection(deep);
    // A body 1e-6 sectors away is a few pixels away, not lost to rounding.
    const dx = p.x(250, 0.123456789, 1e-6) - p.x(250, 0.123456789);
    expect(dx).toBeCloseTo(p.s * 1e-6, 3);
  });
});
