import { describe, expect, it } from 'vitest';
import { lightFromAngle } from '../../toolkit/light';
import { masterPalette } from '../../toolkit/palette';
import { registry } from '../index';
import { CLASS_IDS, starClass } from './classes';

const palette = masterPalette();

describe('star generator', () => {
  it('renders every class deterministically, with only its own ramps', () => {
    for (const id of CLASS_IDS) {
      const a = registry.run('star', { class: id }, 3, { frame: 5 });
      expect(registry.run('star', { class: id }, 3, { frame: 5 }).buffer.data).toEqual(a.buffer.data);
      const cls = starClass(id);
      const allowed = new Set([0, ...palette.ramp(cls.surface.ramp).indices, ...palette.ramp(cls.corona.ramp).indices]);
      for (const v of a.buffer.data) expect(allowed.has(v)).toBe(true);
      expect(a.descriptor.class).toBe(id);
    }
  });

  it('picks the class from the requested seed', () => {
    const seen = new Set<unknown>();
    for (let seed = 0; seed < 300; seed++) seen.add(registry.recipe('star', {}, seed).class);
    expect(seen.size).toBe(CLASS_IDS.length);
  });

  it('sizes the disc by class', () => {
    const radius = (id: string) => registry.run('star', { class: id }, 1, { size: 40 }).descriptor.radius as number;
    expect(radius('red-giant')).toBeGreaterThan(radius('O'));
    expect(radius('O')).toBeGreaterThan(radius('G'));
    expect(radius('G')).toBeGreaterThan(radius('M'));
    expect(radius('M')).toBeGreaterThan(radius('neutron'));
  });

  it('makes its own light: the direction of the light changes nothing', () => {
    const a = registry.run('star', { class: 'K' }, 2, { lightDir: lightFromAngle(90, 10) });
    const b = registry.run('star', { class: 'K' }, 2, { lightDir: lightFromAngle(270, 60) });
    expect(a.buffer.data).toEqual(b.buffer.data);
  });

  it('keeps its catalogue data at every size and frame, and loops its animation', () => {
    const a = registry.run('star', {}, 9);
    const b = registry.run('star', {}, 9, { size: 100, frame: 33 });
    for (const key of ['class', 'label', 'temperature', 'luminosity', 'intensity']) expect(b.descriptor[key]).toEqual(a.descriptor[key]);
    for (const id of ['G', 'red-giant', 'O']) {
      const at = (frame: number) => registry.run('star', { class: id }, 4, { frame }).buffer.data;
      expect(at(96)).toEqual(at(0));
      expect(at(7)).not.toEqual(at(0));
    }
  });
});
