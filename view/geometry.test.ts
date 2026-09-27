import { describe, expect, it } from 'vitest';
import { apoapsis } from '../universe/orbit';
import { sampleSystems } from '../universe/census';
import { Galaxy } from '../universe/galaxy';
import { generateSystem } from '../universe/system';
import { SYSTEM_RADIUS, SystemGeometry } from './geometry';

const galaxy = new Galaxy(0);
const systems = sampleSystems(galaxy, 400, 3).map((r) => generateSystem(galaxy, r.sx, r.sy, r.index));

describe('schematic geometry', () => {
  it('keeps systems apart: two layouts never overlap', () => {
    // Systems sit in distinct cells of a 4 x 4 grid with jitter 0.15..0.85: at least 0.075 apart.
    expect(2 * SYSTEM_RADIUS).toBeLessThan(0.075);
  });

  it('orders orbits outwards inside the layout and keeps planets apart', () => {
    for (const s of systems) {
      const g = new SystemGeometry(s);
      const radii = s.planets.map((p) => g.scale.world(p.orbit.a));
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]).toBeGreaterThan(radii[i - 1]);
        // Discs of neighbouring planets never touch, whatever the angles.
        expect(radii[i] - radii[i - 1]).toBeGreaterThan(g.planetRadius[i] + g.planetRadius[i - 1]);
      }
      for (const p of s.planets) expect(g.scale.world(apoapsis(p.orbit))).toBeLessThanOrEqual(SYSTEM_RADIUS * 1.0001);
      if (radii.length > 0) expect(radii[0] - g.planetRadius[0]).toBeGreaterThan(g.pairOffset + Math.max(...g.starRadius.slice(0, 2)));
    }
  });

  it('puts moons outside their planet (and its rings) and apart from each other', () => {
    for (const s of systems) {
      const g = new SystemGeometry(s);
      s.planets.forEach((p, n) => {
        const d = g.moonDistance[n];
        const r = g.moonRadius[n];
        if (d.length > 0) expect(d[0] - r[0]).toBeGreaterThan(g.planetRadius[n] * (p.rings ? 2.2 : 1.1));
        for (let k = 1; k < d.length; k++) expect(d[k] - d[k - 1]).toBeGreaterThan(r[k] + r[k - 1]);
        // A moon at any tick is at its distance from the planet.
        p.moons.forEach((_, k) => {
          const o = g.moon(n, k, 12345);
          expect(Math.hypot(o.dx, o.dy)).toBeCloseTo(d[k], 12);
        });
      });
    }
  });
});
