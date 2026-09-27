import { describe, expect, it } from 'vitest';
import { Galaxy, MAX_SYSTEMS } from './galaxy';

const SEEDS = [0, 1, 2, 7, 305419896];

function ring(g: Galaxy, r: number, samples = 720): number[] {
  return Array.from({ length: samples }, (_, i) => {
    const a = (2 * Math.PI * i) / samples;
    return g.density(r * Math.cos(a), r * Math.sin(a));
  });
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('galaxy shape', () => {
  it('is a pure function of the seed', () => {
    const a = new Galaxy(42);
    const b = new Galaxy(42);
    expect(b.shape).toEqual(a.shape);
    // Order of queries does not matter: sectors are random access.
    const late = b.sector(-7, 3);
    for (let i = 0; i < 50; i++) b.sector(i, -i);
    expect(a.sector(-7, 3)).toEqual(late);
    expect(new Galaxy(43).shape).not.toEqual(a.shape);
  });

  it('has a dense core, a thinning disc and almost nothing outside', () => {
    for (const seed of SEEDS) {
      const g = new Galaxy(seed);
      const R = g.shape.radius;
      const core = mean(ring(g, 3, 32));
      const mid = mean(ring(g, 0.5 * R));
      const edge = mean(ring(g, 0.95 * R));
      const outside = mean(ring(g, 1.4 * R));
      expect(core).toBeGreaterThan(0.8);
      expect(mid).toBeLessThan(core / 3);
      expect(edge).toBeLessThan(mid);
      expect(outside).toBeLessThan(0.01);
    }
  });

  it('has spiral arms: strong contrast between arms and the space between them', () => {
    for (const seed of SEEDS) {
      const g = new Galaxy(seed);
      // Along a circle through the disc, arm crossings are several times denser than the gaps.
      const d = ring(g, 0.45 * g.shape.radius).sort((x, y) => x - y);
      const low = mean(d.slice(0, d.length / 5));
      const high = mean(d.slice((4 * d.length) / 5));
      expect(high / Math.max(low, 1e-6)).toBeGreaterThan(4);
    }
  });

  it('gives each sector 0..16 systems and a character in range', () => {
    const g = new Galaxy(0);
    let total = 0;
    for (let sy = -40; sy <= 40; sy += 4) {
      for (let sx = -40; sx <= 40; sx += 4) {
        const s = g.sector(sx, sy);
        expect(Number.isInteger(s.count) && s.count >= 0 && s.count <= MAX_SYSTEMS).toBe(true);
        for (const v of [s.age, s.nebula]) expect(v >= 0 && v <= 1).toBe(true);
        expect(s.stars >= 0 && s.stars <= 3 && s.galaxies >= 0 && s.galaxies <= 3).toBe(true);
        expect(s.style >= 0 && s.style < 5).toBe(true);
        total += s.count;
      }
    }
    expect(total).toBeGreaterThan(0);
    // Far outside the galaxy the grid goes on, empty.
    expect(g.sector(100_000, -100_000).count).toBe(0);
    expect(g.sector(-2_000_000_000, 2_000_000_000).count).toBe(0);
  });

  it('makes arms young and the core old', () => {
    const g = new Galaxy(0);
    const core = g.character(2, 2);
    expect(core.age).toBeGreaterThan(0.6);
    expect(core.nebulaRamp).toBe('gas-warm');
    // Youngest point on a ring through the disc is on an arm.
    const R = g.shape.radius * 0.45;
    let youngest = 1;
    for (let i = 0; i < 360; i++) youngest = Math.min(youngest, g.character(R * Math.cos(i), R * Math.sin(i)).age);
    expect(youngest).toBeLessThan(0.35);
  });
});
