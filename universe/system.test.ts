import { describe, expect, it } from 'vitest';
import { sampleSystems } from './census';
import { Galaxy } from './galaxy';
import { isOffensive, isRealName } from './names';
import { apoapsis, periapsis } from './orbit';
import { generateSystem, systemSummary, type StarSystem } from './system';

const galaxy = new Galaxy(0);
const sample = sampleSystems(galaxy, 2000, 1).map((r) => generateSystem(galaxy, r.sx, r.sy, r.index));

/** Radial extents of the non-crossing bodies of a system, in order of distance. */
function extents(s: StarSystem): { name: string; lo: number; hi: number }[] {
  const out = [
    ...s.planets.map((p) => ({ name: p.name, lo: periapsis(p.orbit), hi: apoapsis(p.orbit) })),
    ...s.belts.map((b) => ({ name: b.name, lo: b.inner, hi: b.outer })),
  ];
  return out.sort((a, b) => a.lo - b.lo);
}

describe('star systems', () => {
  it('are pure functions of galaxy, sector and index, with random access', () => {
    const ref = sampleSystems(galaxy, 1, 7)[0];
    const alone = generateSystem(new Galaxy(0), ref.sx, ref.sy, ref.index);
    // Generating neighbours first, in any order, changes nothing.
    const g = new Galaxy(0);
    const count = g.sector(ref.sx, ref.sy).count;
    for (let i = count - 1; i >= 0; i--) generateSystem(g, ref.sx, ref.sy, i);
    for (let i = 0; i < 20; i++) g.sector(ref.sx + i, ref.sy - i);
    expect(generateSystem(g, ref.sx, ref.sy, ref.index)).toEqual(alone);
    expect(JSON.stringify(generateSystem(g, ref.sx, ref.sy, ref.index))).toBe(JSON.stringify(alone));
  });

  it('refuse indices the sector does not have', () => {
    const empty = { sx: 100_000, sy: 0 };
    expect(() => generateSystem(galaxy, empty.sx, empty.sy, 0)).toThrow(RangeError);
    const ref = sampleSystems(galaxy, 1, 3)[0];
    const count = galaxy.sector(ref.sx, ref.sy).count;
    expect(() => generateSystem(galaxy, ref.sx, ref.sy, count)).toThrow(RangeError);
  });

  it('agree with their map summary', () => {
    for (const s of sample.slice(0, 300)) {
      const summary = systemSummary(galaxy.sector(s.sx, s.sy), s.index);
      expect(summary.stars.map((st) => st.class)).toEqual(s.stars.map((st) => st.class));
      expect(summary.position).toEqual(s.position);
    }
  });

  it('never overlap orbits (planets, belts, moons); only comets cross', () => {
    let pairs = 0;
    for (const s of sample) {
      const bodies = extents(s);
      for (let i = 1; i < bodies.length; i++) {
        expect(bodies[i].lo, `${bodies[i - 1].name} / ${bodies[i].name}`).toBeGreaterThanOrEqual(1.2 * bodies[i - 1].hi * 0.999);
        pairs++;
      }
      // The close pair stays well inside the first planet; the distant companion outside the last.
      const first = bodies[0];
      for (const st of s.stars.slice(0, 2)) if (st.orbit !== null && first !== undefined) expect(apoapsis(st.orbit)).toBeLessThan(first.lo / 2);
      if (s.stars.length === 3 && bodies.length > 0) expect(periapsis(s.stars[2].orbit!)).toBeGreaterThan(bodies[bodies.length - 1].hi);
      // Nothing orbits inside a star.
      if (first !== undefined) expect(first.lo).toBeGreaterThan(2 * s.stars[0].radius);
      for (const p of s.planets) {
        for (let m = 1; m < p.moons.length; m++) {
          expect(periapsis(p.moons[m].orbit)).toBeGreaterThanOrEqual(1.2 * apoapsis(p.moons[m - 1].orbit) * 0.999);
        }
        if (p.moons.length > 0) expect(periapsis(p.moons[0].orbit)).toBeGreaterThan(p.rings ? 3 : 2);
      }
    }
    expect(pairs).toBeGreaterThan(3000);
  });

  it('order planets outwards with increasing periods and consistent zones', () => {
    for (const s of sample) {
      for (let i = 1; i < s.planets.length; i++) {
        expect(s.planets[i].orbit.a).toBeGreaterThan(s.planets[i - 1].orbit.a);
        expect(s.planets[i].orbit.period).toBeGreaterThanOrEqual(s.planets[i - 1].orbit.period);
      }
      for (const p of s.planets) {
        if (p.archetype === 'terran' || p.archetype === 'ocean') expect(p.zone).toBe('habitable');
        if (p.archetype === 'gas') expect(p.zone).toBe('frost');
        expect(Number.isSafeInteger(p.orbit.period) && p.orbit.phase >= 0 && p.orbit.phase < p.orbit.period).toBe(true);
        expect(p.rotation.period >= 8 && p.rotation.period <= 4096).toBe(true);
        expect(p.properName !== null).toBe(p.zone === 'habitable');
      }
    }
  });

  it('name systems uniquely inside each sector, without filtered words', () => {
    const sectors = new Map<string, { sx: number; sy: number }>();
    for (const s of sample.slice(0, 150)) sectors.set(`${s.sx},${s.sy}`, { sx: s.sx, sy: s.sy });
    for (const { sx, sy } of sectors.values()) {
      const count = galaxy.sector(sx, sy).count;
      const all = Array.from({ length: count }, (_, i) => generateSystem(galaxy, sx, sy, i));
      expect(new Set(all.map((s) => s.name)).size).toBe(count);
      expect(new Set(all.map((s) => s.code)).size).toBe(count);
      for (const s of all) {
        expect(isRealName(s.name) || isOffensive(s.name)).toBe(false);
        expect(s.code).toMatch(/^[A-Z]{2}-\d{4}$/);
        for (const p of s.planets) {
          expect(p.name.startsWith(`${s.code} `)).toBe(true);
          for (const m of p.moons) expect(m.name).toMatch(new RegExp(`^${p.name} [IVX]+$`));
        }
      }
      // Distinct cells of the 4 x 4 grid.
      expect(new Set(all.map((s) => `${Math.floor(s.position.x * 4)},${Math.floor(s.position.y * 4)}`)).size).toBe(count);
    }
  });
});
