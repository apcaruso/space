// Planet generator: surface and cloud maps sampled on the sphere, projected onto a rotating,
// lit disc, with atmosphere rim and rings. See docs/DESIGN.md, "Pianeti".

import { defineGenerator, type Json } from '../registry';
import { buildMaps, composition, encodeMap, landShare, PlanetModel, MATERIAL_NAMES, type LevelOfDetail, type SurfaceMap } from './maps';
import { planetRecipe, resolvePlanet, type PlanetRecipe } from './recipe';
import { drawPlanet, orientation } from './render';

/** Descriptor map resolution: fixed, so the descriptor is the same at every size. */
const DESCRIPTOR_ROWS = 32;

/** Level of detail for a disc diameter: fewer octaves and crater layers when small. */
function detail(size: number): LevelOfDetail {
  if (size < 32) return { drop: 2, craterLayers: 1, cracks: false, bands: 0.5 };
  if (size < 64) return { drop: 1, craterLayers: 1, cracks: true, bands: 1 };
  if (size < 128) return { drop: 0, craterLayers: 1, cracks: true, bands: 1 };
  return { drop: 0, craterLayers: 2, cracks: true, bands: 1 };
}

// Maps do not depend on frame or light, so animations and relit renders reuse them. The cache
// only saves time: a hit returns exactly what a rebuild would.
const CACHE_SIZE = 8;
const cache = new Map<string, SurfaceMap>();

function cachedMap(r: PlanetRecipe, seed: number, rows: number, lod: LevelOfDetail, smooth: boolean): SurfaceMap {
  const key = `${seed}|${rows}|${smooth}|${lod.drop}|${lod.craterLayers}|${lod.cracks}|${lod.bands}|${JSON.stringify(r)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const map = buildMaps(new PlanetModel(r, seed, lod), rows, smooth);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  cache.set(key, map);
  return map;
}

export const planet = defineGenerator({
  name: 'planet',
  version: 1,
  description: 'pianeti e lune: 9 archetipi, rotazione, nuvole, atmosfera, anelli',
  recipe: planetRecipe,
  resolve: resolvePlanet,
  sizes: { default: 64, min: 16, max: 256 },
  loop: 96,
  // Low sun: a readable terminator, like a planet seen from beside its orbit.
  light: { azimuth: 290, elevation: 25 },
  maxAttempts: 8,
  goldens: [
    { seed: 0 },
    { seed: 1, recipe: { archetype: 'terran' } },
    { seed: 2, recipe: { archetype: 'gas', rings: { chance: 1 } }, frame: 30 },
    { seed: 3, recipe: { archetype: 'lava' }, light: 90 },
    { seed: 4, recipe: { archetype: 'cratered' }, size: 32 },
    { seed: 5, recipe: { archetype: 'ice' }, size: 16 },
    { seed: 6, recipe: { archetype: 'toxic' }, size: 128, frame: 11 },
  ],
  validators: [
    {
      name: 'land',
      check(result, r) {
        const land = result.descriptor.land as number;
        const { landMin, landMax } = r.limits;
        return land < landMin || land > landMax ? `terra ${Math.round(land * 100)}% (serve ${landMin * 100}-${landMax * 100}%)` : null;
      },
    },
    {
      name: 'bands',
      check(result, r) {
        if (r.surface.kind !== 'bands') return null;
        const c = result.descriptor.composition as Record<string, number>;
        const top = Math.max(c['band-dark'] ?? 0, c['band-mid'] ?? 0, c['band-light'] ?? 0);
        return top > 0.62 ? `bande troppo uniformi: una tinta copre il ${Math.round(top * 100)}%` : null;
      },
    },
    {
      name: 'craters',
      check(result, r) {
        if (r.surface.kind !== 'craters') return null;
        const c = result.descriptor.composition as Record<string, number>;
        const cratered = (c['crater-floor'] ?? 0) + (c['crater-rim'] ?? 0);
        return cratered < 0.18 || cratered > 0.6 ? `crateri sul ${Math.round(cratered * 100)}% (serve 18-60%)` : null;
      },
    },
  ],

  generate(r, seed, opts) {
    const lod = detail(opts.size);
    const { axis, rings } = orientation(r, seed);
    // About one map cell per pixel at the centre of the disc.
    const map = cachedMap(r, seed, Math.max(16, Math.ceil(opts.size * 1.6)), lod, true);
    const image = drawPlanet(r, seed, map, axis, rings, opts);

    const identity = cachedMap(r, seed, DESCRIPTOR_ROWS, detail(256), false);
    const encoded = encodeMap(identity);
    const descriptor: Record<string, Json> = {
      archetype: r.archetype,
      radius: opts.size / 2,
      centre: [image.centre, image.centre],
      land: landShare(identity),
      composition: composition(identity),
      axis: { roll: axis.roll, lean: axis.lean },
      rings: rings === null ? null : { inner: rings.inner, outer: rings.outer },
      surface: { width: identity.w, height: identity.h, legend: [...MATERIAL_NAMES], materials: encoded.materials, heights: encoded.heights },
      features: [],
    };
    return { buffer: image.buffer, descriptor };
  },
});
