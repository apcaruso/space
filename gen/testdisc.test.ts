import { describe, expect, it } from 'vitest';
import { lightFromAngle } from '../toolkit/light';
import { masterPalette } from '../toolkit/palette';
import { registry } from './index';

describe('testdisc', () => {
  it('draws a disc of the requested size inside a transparent margin', () => {
    for (const size of [16, 48, 97]) {
      const r = registry.run('testdisc', {}, 1, { size });
      expect([r.buffer.w, r.buffer.h]).toEqual([size, size]);
      expect(r.buffer.get(0, 0)).toBe(0);
      expect(r.buffer.get(size >> 1, size >> 1)).not.toBe(0);
    }
  });

  it('uses only the land and sea ramps', () => {
    const palette = masterPalette();
    const allowed = new Set([0, ...palette.ramp('sand').indices, ...palette.ramp('magma').indices]);
    const r = registry.run('testdisc', { land: 'sand', sea: 'magma' }, 3);
    for (const v of r.buffer.data) expect(allowed.has(v)).toBe(true);
  });

  it('keeps its descriptor when size, frame or light change', () => {
    const base = registry.run('testdisc', {}, 4).descriptor;
    const moved = registry.run('testdisc', {}, 4, { size: 96, frame: 30, lightDir: lightFromAngle(120, 20) }).descriptor;
    expect(moved.landCoverage).toBe(base.landCoverage);
    expect(moved.rotationPeriod).toBe(base.rotationPeriod);
  });

  it('turns with the frame and loops after one period', () => {
    const at = (frame: number) => registry.run('testdisc', { period: 16 }, 2, { frame }).buffer.data;
    expect(at(1)).not.toEqual(at(0));
    expect(at(16)).toEqual(at(0));
    expect(at(-3)).toEqual(at(13));
  });

  it('retries seeds whose land coverage is out of range', () => {
    const r = registry.run('testdisc', { seaLevel: 0.14 }, 6);
    expect(r.attempt).toBeGreaterThan(0);
    expect(r.accepted).toBe(true);
    expect(r.descriptor.landCoverage).toBeGreaterThanOrEqual(0.15);
  });
});
