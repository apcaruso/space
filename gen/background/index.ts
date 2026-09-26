// Background generator: an endless backdrop cut into chunks addressed by integer coordinates.
// Everything is computed from global pixel coordinates, so neighbouring chunks meet without a
// seam; features near a chunk edge are drawn by every chunk they touch. Layers (nebula, far,
// mid and near stars) scroll at different speeds in the app; "all" stacks them for previews.
// Region parameters (star density, nebula amount and colours) come from outside.

import { IndexedBuffer, TRANSPARENT } from '../../core/buffer';
import { atan2, cos, PI, sin } from '../../core/dmath';
import { derive, hashCoords, mix32 } from '../../core/hash';
import { Fbm2, gradientNoise2, Warp2, type Field2 } from '../../core/noise';
import { Rng } from '../../core/rng';
import { BAYER4, bayerThreshold, ditherQuantize } from '../../toolkit/dither';
import { applyTable, masterPalette } from '../../toolkit/palette';
import { defineGenerator, type Json } from '../registry';
import { choice, int, num, obj, type Infer } from '../schema';

const palette = masterPalette();
const RAMPS = palette.ramps.map((r) => r.name);

export const LAYERS = ['nebula', 'far', 'mid', 'near'] as const;
type Layer = (typeof LAYERS)[number];

const COORD = 1_000_000_000;

const recipe = obj({
  layer: choice(['all', ...LAYERS], 'all', 'strato: nebula, far, mid, near, o all (tutti sovrapposti su fondo spazio)'),
  chunk: obj({
    x: int(0, -COORD, COORD, 'colonna del chunk'),
    y: int(0, -COORD, COORD, 'riga del chunk'),
  }),
  region: obj({
    stars: num(1, 0, 3, 'densità delle stelle della regione'),
    nebula: num(0.5, 0, 1, 'quantità di nebulose della regione'),
    nebulaRamp: choice(RAMPS, 'gas-violet', 'colore dominante delle nebulose'),
    accentRamp: choice(RAMPS, 'ocean', 'colore secondario delle nebulose'),
    galaxies: num(1, 0, 3, 'frequenza delle galassie lontane'),
  }),
  twinkle: int(6, 1, 64, 'frame per passo dello scintillio (palette cycling)'),
});

type Recipe = Infer<typeof recipe>;

/** Stars twinkle by palette cycling on this ramp; nothing else in the backdrop uses it. */
const TWINKLE = palette.ramp('metal-light');
const idx = (ramp: string, tone: number) => palette.index(ramp, tone);

interface StarLayer {
  /** Grid cell in pixels; each cell holds at most one star. */
  cell: number;
  /** Chance of a star per cell at density 1. */
  chance: number;
  /** Colours by weight: [ramp, tone, weight]. */
  colours: readonly (readonly [string, number, number])[];
  /** Share of stars that twinkle, and the twinkle tones they may start from. */
  twinkle: number;
  twinkleTones: readonly number[];
  /** Chances of a plus-shaped and of a cross-shaped (bright) star. */
  plus: number;
  cross: number;
}

const STAR_LAYERS: Record<Exclude<Layer, 'nebula'>, StarLayer> = {
  far: {
    cell: 9,
    chance: 0.5,
    colours: [['space', 2, 5], ['space', 3, 4], ['metal-dark', 2, 2], ['basalt', 3, 1]],
    twinkle: 0,
    twinkleTones: [],
    plus: 0,
    cross: 0,
  },
  mid: {
    cell: 22,
    chance: 0.5,
    colours: [['ash', 1, 4], ['ice', 0, 3], ['gas-warm', 1, 2], ['gas-cold', 2, 2], ['magma', 0, 1]],
    twinkle: 0.25,
    twinkleTones: [0, 1],
    plus: 0,
    cross: 0,
  },
  near: {
    cell: 54,
    chance: 0.42,
    colours: [['ice', 1, 3], ['sand', 1, 2], ['ash', 2, 3], ['coast', 1, 1], ['magma', 2, 1]],
    twinkle: 0.35,
    twinkleTones: [0, 1, 2],
    plus: 0.25,
    cross: 0.06,
  },
};

function pickColour(colours: StarLayer['colours'], t: number): number {
  const total = colours.reduce((s, c) => s + c[2], 0);
  let x = t * total;
  for (const [ramp, tone, weight] of colours) {
    x -= weight;
    if (x < 0) return idx(ramp, tone);
  }
  const last = colours[colours.length - 1];
  return idx(last[0], last[1]);
}

/** Draws one star layer into `out`, whose top-left pixel is at global (ox, oy). */
function drawStars(out: IndexedBuffer, layer: StarLayer, seed: number, ox: number, oy: number, density: number): number {
  const reach = 2; // widest star arm, px
  const c0x = Math.floor((ox - reach) / layer.cell);
  const c0y = Math.floor((oy - reach) / layer.cell);
  const c1x = Math.floor((ox + out.w + reach) / layer.cell);
  const c1y = Math.floor((oy + out.h + reach) / layer.cell);
  let count = 0;
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const h = hashCoords(seed, cx, cy);
      if ((h & 0xffff) / 65536 >= layer.chance * density) continue;
      const h2 = mix32(h ^ 0x9e3779b9);
      const h3 = mix32(h2 ^ 0x85ebca6b);
      const x = cx * layer.cell + ((h >>> 16) % layer.cell) - ox;
      const y = cy * layer.cell + ((h2 & 0xffff) % layer.cell) - oy;
      const r = (h3 & 0xffff) / 65536;
      const twinkles = (h2 >>> 16) / 65536 < layer.twinkle;
      const colour = twinkles
        ? TWINKLE.indices[layer.twinkleTones[(h3 >>> 16) % layer.twinkleTones.length]]
        : pickColour(layer.colours, (h3 >>> 16) / 65536);
      if (x >= 0 && y >= 0 && x < out.w && y < out.h) count++;
      out.set(x, y, colour);
      if (r < layer.cross) {
        // Bright star: white core, dim arms of length 2.
        out.set(x, y, idx('cloud', 3));
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          out.set(x + dx, y + dy, idx('ice', 1));
          out.set(x + 2 * dx, y + 2 * dy, idx('space', 3));
        }
      } else if (r < layer.cross + layer.plus) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) out.set(x + dx, y + dy, idx('space', 3));
      }
    }
  }
  return count;
}

const GALAXY_CELL = 192;
const GALAXY_REACH = 8;

/** Rare, small, dim galaxies in the far layer. Returns those whose centre is in the chunk. */
function drawGalaxies(out: IndexedBuffer, seed: number, ox: number, oy: number, amount: number): Json[] {
  const found: Json[] = [];
  const c0x = Math.floor((ox - GALAXY_REACH) / GALAXY_CELL);
  const c0y = Math.floor((oy - GALAXY_REACH) / GALAXY_CELL);
  const c1x = Math.floor((ox + out.w + GALAXY_REACH) / GALAXY_CELL);
  const c1y = Math.floor((oy + out.h + GALAXY_REACH) / GALAXY_CELL);
  for (let cy = c0y; cy <= c1y; cy++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      const rng = new Rng(hashCoords(seed, cx, cy));
      if (!rng.chance(0.28 * amount)) continue;
      const gx = cx * GALAXY_CELL + rng.int(GALAXY_REACH, GALAXY_CELL - GALAXY_REACH);
      const gy = cy * GALAXY_CELL + rng.int(GALAXY_REACH, GALAXY_CELL - GALAXY_REACH);
      const size = rng.range(2.5, 6.5);
      const flat = rng.range(0.35, 1);
      const angle = rng.range(0, PI);
      const spiral = rng.chance(0.6);
      const warm = rng.chance(0.5);
      const x0 = gx - ox;
      const y0 = gy - oy;
      if (x0 >= 0 && y0 >= 0 && x0 < out.w && y0 < out.h) found.push({ x: gx, y: gy, size: Math.round(size * 20) / 10, kind: spiral ? 'spiral' : 'elliptical' });
      const ca = cos(angle);
      const sa = sin(angle);
      const reach = Math.ceil(size) + 1;
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          // Galaxy frame: rotate, then squash the minor axis.
          const u = (dx * ca + dy * sa) / size;
          const v = (dy * ca - dx * sa) / (size * flat);
          const r = Math.sqrt(u * u + v * v);
          if (r > 1) continue;
          let glow = 1 - r;
          if (spiral && r > 0.25) {
            // Two arms winding outwards.
            const arm = Math.abs(sin(2 * atan2(v, u) - 7 * r));
            glow *= arm > 0.6 ? 1 : 0.35;
          }
          const tone = glow > 0.75 ? (warm ? idx('sand', 1) : idx('metal-light', 1)) : glow > 0.35 ? idx('space', 3) : glow > 0.12 ? idx('space', 2) : TRANSPARENT;
          if (tone !== TRANSPARENT) out.set(x0 + dx, y0 + dy, tone);
        }
      }
    }
  }
  return found;
}

/** Nebula field in global pixel coordinates. */
function nebulaFields(seed: number): { main: Field2; accent: Field2 } {
  const base = new Fbm2(gradientNoise2, derive(seed, 'nebula'), { octaves: 5, gain: 0.55, frequency: 1 / 170 });
  const main = new Warp2(base, derive(seed, 'nebula', 'warp'), { amplitude: 70, octaves: 3, frequency: 1 / 260 });
  const accent = new Fbm2(gradientNoise2, derive(seed, 'nebula', 'accent'), { octaves: 3, frequency: 1 / 420 });
  return { main, accent };
}

/**
 * Nebula layer: a dim neutral haze (space tone 2), then tones 0 and 1 of the region's ramps in
 * the denser cores; dithered at every edge, transparent below the threshold. Kept dark so the
 * backdrop never competes with the objects in front.
 */
function drawNebula(out: IndexedBuffer, r: Recipe, seed: number, ox: number, oy: number): number {
  if (r.region.nebula <= 0) return 0;
  const { main, accent } = nebulaFields(seed);
  const mainRamp = palette.ramp(r.region.nebulaRamp).indices;
  const accentRamp = palette.ramp(r.region.accentRamp).indices;
  const haze = idx('space', 2);
  // More nebula lowers the threshold; values of the fbm sit mostly within +-0.4.
  const threshold = 0.3 - 0.36 * r.region.nebula;
  const step = 0.12;
  let covered = 0;
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const gx = ox + x;
      const gy = oy + y;
      const t = bayerThreshold(BAYER4, gx, gy);
      const level = ditherQuantize((main.sample(gx, gy) - threshold) / step + 1, t, 0.7) - 1;
      if (level < 0) continue;
      covered++;
      if (level === 0) {
        out.set(x, y, haze);
        continue;
      }
      // The accent colour takes over in its own regions, with a dithered border.
      const ramp = accent.sample(gx, gy) + (t - 0.5) * 0.1 > 0.12 ? accentRamp : mainRamp;
      out.set(x, y, ramp[Math.min(level, 2) - 1]);
    }
  }
  return covered / (out.w * out.h);
}

function drawLayer(out: IndexedBuffer, layer: Layer, r: Recipe, seed: number, ox: number, oy: number): Record<string, Json> {
  const info: Record<string, Json> = {};
  if (layer === 'nebula') {
    info.nebula = Math.round(drawNebula(out, r, seed, ox, oy) * 1000) / 1000;
    return info;
  }
  if (layer === 'far') info.galaxies = drawGalaxies(out, derive(seed, 'galaxies'), ox, oy, r.region.galaxies);
  info[`${layer}Stars`] = drawStars(out, STAR_LAYERS[layer], derive(seed, 'stars', layer), ox, oy, r.region.stars);
  return info;
}

export const background = defineGenerator({
  name: 'background',
  version: 1,
  description: 'sfondo infinito a chunk: nebulose, stelle a tre strati di parallasse con scintillio, galassie lontane',
  recipe,
  sizes: { default: 256, min: 64, max: 512 },
  loop: 48,
  goldens: [
    { seed: 0 },
    { seed: 0, recipe: { chunk: { x: 1, y: 0 } } },
    { seed: 1, recipe: { layer: 'nebula', chunk: { x: -3, y: 7 }, region: { nebula: 1, nebulaRamp: 'crystal-teal' } } },
    { seed: 2, recipe: { layer: 'near', chunk: { x: 5, y: -2 }, region: { stars: 2 } }, frame: 13 },
    { seed: 3, recipe: { layer: 'far', region: { galaxies: 3 } }, size: 128 },
  ],

  generate(r: Recipe, seed, opts) {
    const size = opts.size;
    const ox = r.chunk.x * size;
    const oy = r.chunk.y * size;
    const layers: readonly Layer[] = r.layer === 'all' ? LAYERS : [r.layer as Layer];
    let buffer = new IndexedBuffer(size, size);
    if (r.layer === 'all') buffer.fill(idx('space', 0));
    const info: Record<string, Json> = {};
    for (const layer of layers) {
      const part = new IndexedBuffer(size, size);
      Object.assign(info, drawLayer(part, layer, r, seed, ox, oy));
      buffer.blit(part, 0, 0);
    }
    // Twinkle: palette cycling on the twinkle ramp, tones 0..2, applied to the backdrop only.
    const table = palette.cycleTable(TWINKLE, Math.floor(opts.frame / r.twinkle), { from: 0, to: 2 });
    buffer = applyTable(buffer, table);
    return {
      buffer,
      descriptor: { chunk: [r.chunk.x, r.chunk.y], layer: r.layer, origin: [ox, oy], ...info },
    };
  },
});
