import { describe, expect, it } from 'vitest';
import { lightFromAngle } from '../../toolkit/light';
import { masterPalette } from '../../toolkit/palette';
import { registry } from '../index';
import { Registry } from '../registry';
import { planet } from './index';
import { ARCHETYPES, deepMerge, pickArchetype, resolvePlanet, type PlanetRecipe } from './recipe';

const palette = masterPalette();
const LEFT = lightFromAngle(270, 20);

describe('planet recipes', () => {
  it('picks the archetype from the requested seed, or takes the one asked for', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 400; seed++) {
      const a = pickArchetype(seed);
      counts.set(a, (counts.get(a) ?? 0) + 1);
      expect(registry.recipe('planet', {}, seed).archetype).toBe(a);
    }
    expect(counts.size).toBe(ARCHETYPES.length);
    expect(registry.recipe('planet', { archetype: 'lava' }, 3).archetype).toBe('lava');
  });

  it('layers the input over the archetype preset', () => {
    const r = registry.recipe('planet', { archetype: 'lava', levels: { sea: 0.2 } }, 1) as unknown as PlanetRecipe;
    expect(r.levels.sea).toBe(0.2);
    expect(r.ramps.liquid).toBe('magma');
    expect(r.emissive.liquid).toBeGreaterThan(0);
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3 } })).toEqual({ a: { b: 1, c: 3 } });
  });

  it('lets the schema report unknown archetypes', () => {
    expect(() => registry.recipe('planet', { archetype: 'jungle' }, 0)).toThrow('ricetta.archetype');
    expect(resolvePlanet({ archetype: 'jungle' }, 0)).toEqual({ archetype: 'jungle' });
  });

  it('keeps the archetype chosen from the seed across retries', () => {
    const r = registry.run('planet', { archetype: 'terran', limits: { landMin: 0.62, landMax: 0.9 } }, 5);
    expect(r.recipe.archetype).toBe('terran');
    expect(r.descriptor.archetype).toBe('terran');
  });
});

describe('planet generator', () => {
  it('renders every archetype deterministically', () => {
    for (const archetype of ARCHETYPES) {
      const a = registry.run('planet', { archetype, rings: { chance: 0 } }, 7, { size: 32 });
      const b = registry.run('planet', { archetype, rings: { chance: 0 } }, 7, { size: 32 });
      expect(a.buffer.data).toEqual(b.buffer.data);
      expect([a.buffer.w, a.buffer.h]).toEqual([34, 34]);
      expect(a.descriptor.archetype).toBe(archetype);
    }
  });

  it('draws a disc of the requested diameter with a 1 px margin', () => {
    for (const size of [16, 33, 64, 256]) {
      const r = registry.run('planet', { archetype: 'dead', rings: { chance: 0 } }, 2, { size });
      expect(r.buffer.w).toBe(size + 2);
      expect(r.descriptor.radius).toBe(size / 2);
      expect(r.buffer.get(0, 0)).toBe(0);
      expect(r.buffer.get((size + 2) >> 1, (size + 2) >> 1)).not.toBe(0);
    }
  });

  it('keeps its identity (descriptor) at every size, frame and light', () => {
    const base = registry.run('planet', {}, 11).descriptor;
    const other = registry.run('planet', {}, 11, { size: 160, frame: 37, lightDir: LEFT }).descriptor;
    for (const key of ['archetype', 'land', 'composition', 'surface', 'axis', 'rings', 'features']) {
      expect(other[key]).toEqual(base[key]);
    }
    expect(base.features).toEqual([]);
  });

  it('loops its rotation after the surface and cloud periods', () => {
    const recipe = { archetype: 'terran', period: 32, clouds: { period: 16 } };
    const at = (frame: number) => registry.run('planet', recipe, 4, { frame }).buffer.data;
    expect(at(3)).not.toEqual(at(0));
    expect(at(32)).toEqual(at(0));
    expect(at(-5)).toEqual(at(27));
    // Default periods (surface 96, clouds 48) loop over the generator's 96-frame loop.
    const def = (frame: number) => registry.run('planet', { archetype: 'terran' }, 4, { frame }).buffer.data;
    expect(def(96)).toEqual(def(0));
  });

  it('keeps the night side dark, except for glowing magma', () => {
    const rightmost = (archetype: string) => {
      const r = registry.run('planet', { archetype, rings: { chance: 0 }, atmosphere: { strength: 0 } }, 3, { lightDir: LEFT });
      const c = r.buffer.w >> 1;
      const values = new Set<number>();
      // With the light 20 degrees above the left horizon the terminator is about 11 px right of centre.
      for (let x = c + 16; x < r.buffer.w - 3; x++) for (let y = c - 4; y <= c + 4; y++) values.add(r.buffer.get(x, y));
      return values;
    };
    const space = new Set(palette.ramp('space').indices);
    for (const v of rightmost('terran')) expect(space.has(v)).toBe(true);
    const lava = [...rightmost('lava')];
    expect(lava.some((v) => palette.ramp('magma').indices.includes(v))).toBe(true);
  });

  it('draws rings around the planet, shadowed behind it', () => {
    const r = registry.run('planet', { archetype: 'gas', rings: { chance: 1 } }, 2, { lightDir: lightFromAngle(250, 25) });
    expect(r.buffer.w).toBeGreaterThan(66);
    expect(r.descriptor.rings).not.toBeNull();
    const ring = new Set(palette.ramp((r.recipe as unknown as PlanetRecipe).rings.ramp).indices);
    const used = new Set(r.buffer.data);
    expect([...used].some((v) => ring.has(v))).toBe(true);
    const plain = registry.run('planet', { archetype: 'gas', rings: { chance: 0 } }, 2);
    expect(plain.descriptor.rings).toBeNull();
    expect(plain.buffer.w).toBe(66);
  });

  it('describes the surface with a fixed-size map', () => {
    const d = registry.run('planet', { archetype: 'ocean' }, 9, { size: 24 }).descriptor;
    const surface = d.surface as { width: number; height: number; materials: string; heights: string; legend: string[] };
    expect([surface.width, surface.height]).toEqual([64, 32]);
    expect(surface.materials).toHaveLength(64 * 32);
    expect(surface.heights).toHaveLength(64 * 32);
    expect(surface.legend[1]).toBe('liquid');
    const land = d.land as number;
    expect(land).toBeGreaterThanOrEqual(0.02);
    expect(land).toBeLessThanOrEqual(0.35);
  });

  it('rejects results outside the validator limits', () => {
    const r = registry.run('planet', { archetype: 'terran', limits: { landMin: 0.99, landMax: 1 } }, 1);
    expect(r.accepted).toBe(false);
    expect(r.rejections[0].reasons[0].validator).toBe('land');
    expect(r.rejections[0].reasons[0].reason).toMatch(/^terra \d+% \(serve 99-100%\)$/);
  });
});

describe('validation without rasterising', () => {
  it('picks the same attempt with describe as with a canonical render', () => {
    const withRender = new Registry([{ ...planet, describe: undefined }]);
    const withDescribe = new Registry([planet]);
    let retried = 0;
    // A narrow land range forces rejections, so retries are compared too.
    const recipes = [{ archetype: 'terran', limits: { landMin: 0.45, landMax: 0.6 } }, { archetype: 'ocean' }, { archetype: 'cratered' }, { archetype: 'gas' }];
    for (const recipe of recipes) {
      for (let seed = 0; seed < 20; seed++) {
        const a = withRender.select('planet', recipe, seed);
        const b = withDescribe.select('planet', recipe, seed);
        expect(b.seedUsed).toBe(a.seedUsed);
        expect(b.accepted).toBe(a.accepted);
        if (a.attempt > 0) retried++;
      }
    }
    expect(retried).toBeGreaterThan(3);
  });

  it('shares the attempt between the planet and its surface map', () => {
    for (let seed = 0; seed < 16; seed++) {
      expect(registry.select('surface', { archetype: 'terran' }, seed).seedUsed).toBe(registry.select('planet', { archetype: 'terran' }, seed).seedUsed);
    }
  });
});
