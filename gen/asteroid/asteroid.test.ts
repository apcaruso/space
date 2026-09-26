import { describe, expect, it } from 'vitest';
import { lightFromAngle } from '../../toolkit/light';
import { masterPalette } from '../../toolkit/palette';
import { registry } from '../index';
import { MATERIALS } from './index';

const palette = masterPalette();

describe('asteroid generator', () => {
  it('renders every material deterministically at every size', () => {
    for (const material of MATERIALS) {
      for (const size of [6, 17, 48]) {
        const a = registry.run('asteroid', { material }, 5, { size });
        expect(registry.run('asteroid', { material }, 5, { size }).buffer.data).toEqual(a.buffer.data);
        expect(a.descriptor.material).toBe(material);
        expect(a.descriptor.radius).toBe(size / 2);
        expect(a.buffer.data.some((v) => v !== 0)).toBe(true);
      }
    }
  });

  it('picks the material from the requested seed', () => {
    const seen = new Set<unknown>();
    for (let seed = 0; seed < 100; seed++) seen.add(registry.recipe('asteroid', {}, seed).material);
    expect(seen.size).toBe(MATERIALS.length);
  });

  it('describes its outline for picking: 32 radii around a mean of 1, the same at every frame and light', () => {
    const a = registry.run('asteroid', {}, 8);
    const b = registry.run('asteroid', {}, 8, { frame: 40, lightDir: lightFromAngle(45, 30) });
    const contour = a.descriptor.contour as number[];
    expect(contour).toHaveLength(32);
    const mean = contour.reduce((s, r) => s + r, 0) / contour.length;
    expect(mean).toBeGreaterThan(0.9);
    expect(mean).toBeLessThan(1.1);
    expect(b.descriptor).toEqual(a.descriptor);
  });

  it('spins with the frame and loops after its period', () => {
    const at = (frame: number) => registry.run('asteroid', { period: 24 }, 3, { frame }).buffer.data;
    expect(at(6)).not.toEqual(at(0));
    expect(at(24)).toEqual(at(0));
  });

  it('keeps the side away from the light dark', () => {
    const r = registry.run('asteroid', { material: 'icy' }, 2, { size: 40, lightDir: lightFromAngle(270, 10) });
    const space = new Set([0, ...palette.ramp('space').indices]);
    const c = r.buffer.w >> 1;
    let lit = 0;
    for (let y = c - 3; y <= c + 3; y++) for (let x = c + 6; x < r.buffer.w; x++) if (!space.has(r.buffer.get(x, y))) lit++;
    expect(lit).toBe(0);
  });

  it('rejects asteroids that are too round', () => {
    const r = registry.run('asteroid', { shape: { lumpiness: 0, elongation: 0 } }, 1);
    expect(r.accepted).toBe(false);
    expect(r.rejections[0].reasons[0].validator).toBe('shape');
  });
});
