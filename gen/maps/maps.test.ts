import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../core/fingerprint';
import { sampleSystems } from '../../universe/census';
import { Galaxy } from '../../universe/galaxy';
import { generateSystem } from '../../universe/system';
import { regionMap } from './galaxy';
import { systemView } from './system';

describe('maps', () => {
  it('draw a region deterministically, with every system of its sectors', () => {
    const g = new Galaxy(0);
    const a = regionMap(g, { cx: -20, cy: 60, radius: 2, cell: 8 });
    const b = regionMap(new Galaxy(0), { cx: -20, cy: 60, radius: 2, cell: 8 });
    expect([a.buffer.w, a.buffer.h]).toEqual([40, 40]);
    expect(fingerprint(b.buffer)).toBe(fingerprint(a.buffer));
    let systems = 0;
    for (let y = 58; y <= 62; y++) for (let x = -22; x <= -18; x++) systems += g.sector(x, y).count;
    expect(a.systems).toBe(systems);
  });

  it('draw a system deterministically, and it moves with time', () => {
    const g = new Galaxy(0);
    const ref = sampleSystems(g, 40, 5).find((r) => generateSystem(g, r.sx, r.sy, r.index).planets.length >= 2);
    if (ref === undefined) throw new Error('no system with planets');
    const s = generateSystem(g, ref.sx, ref.sy, ref.index);
    const sector = g.sector(ref.sx, ref.sy);
    const view = (tick: number) => fingerprint(systemView(s, sector, { size: 96, tick, frame: 0 }));
    expect(view(500)).toBe(view(500));
    expect(view(500)).not.toBe(view(500 + Math.round(s.planets[0].orbit.period / 4)));
  });
});
