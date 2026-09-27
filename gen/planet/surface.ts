// Surface map of a planet: the equirectangular map of its materials, drawn at pixel scale with
// relief shading from a high sun in the north-west. Same recipe, validators and descriptor as
// `planet`, so the registry picks the same attempt and the map is the planet's own surface.

import { FloatField, IndexedBuffer } from '../../core/buffer';
import { cos, PI } from '../../core/dmath';
import { BAYER4 } from '../../toolkit/dither';
import { lightFromAngle } from '../../toolkit/light';
import { masterPalette } from '../../toolkit/palette';
import { shade } from '../../toolkit/shade';
import { defineGenerator, type Json } from '../registry';
import { cachedMap, describePlanet, detail, PLANET_VALIDATORS } from './index';
import { M, MATERIAL_NAMES } from './maps';
import { planetRecipe, resolvePlanet } from './recipe';
import { materials } from './render';

const palette = masterPalette();
const SUN = lightFromAngle(315, 30);

export const surface = defineGenerator({
  name: 'surface',
  version: 1,
  description: 'mappa equirettangolare della superficie di un pianeta, con rilievo ombreggiato',
  recipe: planetRecipe,
  resolve: resolvePlanet,
  // Size is the map width; the height is half of it.
  sizes: { default: 256, min: 64, max: 512 },
  loop: 1,
  maxAttempts: 8,
  goldens: [
    { seed: 1, recipe: { archetype: 'terran' } },
    { seed: 2, recipe: { archetype: 'gas' }, size: 128 },
    { seed: 4, recipe: { archetype: 'cratered' }, size: 192 },
  ],
  validators: PLANET_VALIDATORS,
  describe: describePlanet,

  generate(r, seed, opts) {
    const w = opts.size - (opts.size % 2);
    const h = w / 2;
    // Full detail and no smoothing below 256 rows would lose the craters: rows at least 64.
    const rows = Math.max(64, h);
    const map = cachedMap(r, seed, rows, detail(256), true);
    const heights = new FloatField(w, h);
    const mats = new IndexedBuffer(w, h);
    // Shares weighted by area: rows near the poles cover less of the sphere than the map shows.
    const shares = new Float64Array(MATERIAL_NAMES.length);
    let total = 0;
    for (let y = 0; y < h; y++) {
      const my = Math.min(map.h - 1, Math.floor(((y + 0.5) / h) * map.h));
      const weight = cos(PI / 2 - ((y + 0.5) / h) * PI);
      for (let x = 0; x < w; x++) {
        const mx = Math.min(map.w - 1, Math.floor(((x + 0.5) / w) * map.w));
        const code = map.codes[my * map.w + mx];
        mats.set(x, y, code);
        heights.set(x, y, map.heights[my * map.w + mx] * h * 0.6);
        shares[code] += weight;
        total += weight;
      }
    }
    const buffer = shade(heights, mats, materials(r), palette, { light: SUN, dither: BAYER4, ditherWidth: 0.3, levels: 4, reserveDarkest: false });
    const table = materials(r);
    const legend: Json[] = [];
    for (let code = 1; code < MATERIAL_NAMES.length; code++) {
      if (shares[code] === 0 || code === M.cloud) continue;
      const ramp = table[code - 1].ramp;
      legend.push({ material: MATERIAL_NAMES[code], ramp, share: Math.round((shares[code] / total) * 1000) / 1000 });
    }
    return { buffer, descriptor: { ...describePlanet(r, seed), width: w, height: h, legend, centre: [w / 2, h / 2] } };
  },
});
