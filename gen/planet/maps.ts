// Surface and cloud maps. The planet is a set of fields on the unit sphere (planet frame: z is
// the north pole); maps are equirectangular samples of them, 2H x H, with no seam.

import { asin, atan2, cos, PI, sin, TAU } from '../../core/dmath';
import { derive, mix32 } from '../../core/hash';
import { createCellSample, Fbm3, gradientNoise3, Warp3, worley3, type Field3 } from '../../core/noise';
import { Rng } from '../../core/rng';
import type { PlanetRecipe } from './recipe';

/** Material codes of the maps (0 = empty). */
export const M = {
  liquid: 1,
  shallows: 2,
  lowland: 3,
  highland: 4,
  cap: 5,
  crack: 6,
  bandDark: 7,
  bandMid: 8,
  bandLight: 9,
  storm: 10,
  craterFloor: 11,
  craterRim: 12,
  cloud: 13,
} as const;

export const MATERIAL_NAMES = [
  'none', 'liquid', 'shallows', 'lowland', 'highland', 'cap', 'crack',
  'band-dark', 'band-mid', 'band-light', 'storm', 'crater-floor', 'crater-rim', 'cloud',
] as const;

const LIQUIDS = new Set<number>([M.liquid, M.shallows]);

const FIB_SAMPLES = 1024;
const GOLDEN_ANGLE = PI * (3 - Math.sqrt(5));

/** Evenly spread points on the unit sphere (Fibonacci lattice): size-independent statistics. */
function fibonacciPoint(i: number, n: number, out: Float64Array): void {
  const z = 1 - (2 * i + 1) / n;
  const ring = Math.sqrt(1 - z * z);
  const phi = i * GOLDEN_ANGLE;
  out[0] = cos(phi) * ring;
  out[1] = sin(phi) * ring;
  out[2] = z;
}

/** Sum of the first `count` amplitudes of a geometric series with ratio `gain`. */
function amplitudeSum(gain: number, count: number): number {
  let sum = 0;
  let a = 1;
  for (let i = 0; i < count; i++) {
    sum += a;
    a *= gain;
  }
  return sum;
}

/**
 * fbm with the high octaves dropped but the full normalisation kept: the low-frequency shape,
 * and so every coastline, stays where it is at every size.
 */
class Detail implements Field3 {
  private readonly field: Field3;
  private readonly scale: number;

  constructor(field: Field3, gain: number, full: number, used: number) {
    this.field = field;
    this.scale = amplitudeSum(gain, used) / amplitudeSum(gain, full);
  }

  sample(x: number, y: number, z: number): number {
    return this.field.sample(x, y, z) * this.scale;
  }
}

function terrainField(r: PlanetRecipe, seed: number, octaves: number): Field3 {
  const s = r.surface;
  const base = new Detail(new Fbm3(gradientNoise3, derive(seed, 'terrain'), { octaves, gain: s.gain, frequency: s.scale }), s.gain, s.octaves, octaves);
  if (s.warp === 0) return base;
  return new Warp3(base, derive(seed, 'warp'), { amplitude: s.warp / s.scale, octaves: 2, frequency: s.scale });
}

class Stretched implements Field3 {
  private readonly field: Field3;
  private readonly stretch: number;

  constructor(field: Field3, stretch: number) {
    this.field = field;
    this.stretch = stretch;
  }

  sample(x: number, y: number, z: number): number {
    return this.field.sample(x, y, z * this.stretch);
  }
}

function cloudField(r: PlanetRecipe, seed: number, octaves: number): Field3 {
  const c = r.clouds;
  const base = new Detail(new Fbm3(gradientNoise3, derive(seed, 'clouds'), { octaves, gain: 0.55, frequency: c.scale }), 0.55, c.octaves, octaves);
  return new Stretched(new Warp3(base, derive(seed, 'clouds', 'warp'), { amplitude: 0.6 / c.scale, octaves: 2, frequency: c.scale }), c.stretch);
}

/** Level of detail of a render: dropped octaves, crater layers, cracks, band-count factor. */
export interface LevelOfDetail {
  readonly drop: number;
  readonly craterLayers: number;
  readonly cracks: boolean;
  readonly bands: number;
}

interface Storm {
  lat: number;
  lon: number;
  a: number;
  b: number;
}

interface Distribution {
  lo: number;
  hi: number;
  sorted: Float64Array;
}

// Normalisation depends only on the full-detail field, not on the level of detail, so every
// model of one planet shares it. Remembering it only saves time.
const DISTRIBUTIONS = 256;
const distributions = new Map<string, Distribution>();

function sharedDistribution(key: string, field: () => Field3): Distribution {
  const hit = distributions.get(key);
  if (hit !== undefined) return hit;
  const d = distribution(field());
  if (distributions.size >= DISTRIBUTIONS) distributions.delete(distributions.keys().next().value as string);
  distributions.set(key, d);
  return d;
}

/** Normalisation range and value distribution of a field over the Fibonacci points. */
function distribution(field: Field3): Distribution {
  const p = new Float64Array(3);
  const values = new Float64Array(FIB_SAMPLES);
  for (let i = 0; i < FIB_SAMPLES; i++) {
    fibonacciPoint(i, FIB_SAMPLES, p);
    values[i] = field.sample(p[0], p[1], p[2]);
  }
  values.sort();
  return { lo: values[0], hi: values[FIB_SAMPLES - 1], sorted: values };
}

/**
 * Every field of one planet at one level of detail. `octaveDrop` removes high octaves for small
 * sizes; normalisation always comes from the full-detail fields, so classification thresholds
 * mean the same at every size.
 */
export class PlanetModel {
  readonly recipe: PlanetRecipe;
  private readonly terrain: Field3;
  private readonly cracks: Field3 | null;
  private readonly clouds: Field3 | null;
  private readonly lo: number;
  private readonly range: number;
  private readonly cloudLo: number;
  private readonly cloudRange: number;
  /** Normalised cloud value above which the sky is cloudy. */
  private readonly cloudThreshold: number;
  private readonly storms: readonly Storm[];
  private readonly bandCount: number;
  private readonly bandTurbulence: number;
  private readonly bandShift: number;
  private readonly craterSeeds: readonly number[];
  private readonly craterLayers: number;
  private readonly cell = createCellSample();

  /** Outputs of classify(), written in place. */
  code = 0;
  height = 0;

  constructor(r: PlanetRecipe, seed: number, lod: LevelOfDetail) {
    const { drop: octaveDrop, craterLayers, cracks } = lod;
    this.recipe = r;
    const octaves = Math.max(1, r.surface.octaves - octaveDrop);
    this.terrain = terrainField(r, seed, octaves);
    const key = `${seed}|${JSON.stringify(r)}`;
    const t = sharedDistribution(`terrain|${key}`, () => (octaveDrop === 0 ? this.terrain : terrainField(r, seed, r.surface.octaves)));
    this.lo = t.lo;
    this.range = t.hi - t.lo || 1;

    this.cracks =
      cracks && r.levels.cracks > 0
        ? new Fbm3(gradientNoise3, derive(seed, 'cracks'), { octaves: 3, gain: 0.5, frequency: r.surface.scale * 1.3 })
        : null;

    if (r.clouds.coverage > 0) {
      const co = Math.max(1, r.clouds.octaves - octaveDrop);
      this.clouds = cloudField(r, seed, co);
      const clouds = this.clouds;
      const c = sharedDistribution(`clouds|${key}`, () => (co === r.clouds.octaves ? clouds : cloudField(r, seed, r.clouds.octaves)));
      this.cloudLo = c.lo;
      this.cloudRange = c.hi - c.lo || 1;
      const q = c.sorted[Math.min(FIB_SAMPLES - 1, Math.floor((1 - r.clouds.coverage) * FIB_SAMPLES))];
      this.cloudThreshold = (q - c.lo) / this.cloudRange;
    } else {
      this.clouds = null;
      this.cloudLo = 0;
      this.cloudRange = 1;
      this.cloudThreshold = 2;
    }

    const rng = new Rng(derive(seed, 'storms'));
    const stormCount = r.surface.kind === 'bands' ? rng.int(Math.max(0, r.bands.storms - 1), r.bands.storms) : 0;
    // The first storm is the great one; the others are smaller.
    this.storms = Array.from({ length: stormCount }, (_, i) => {
      const a = i === 0 ? rng.range(0.32, 0.5) : rng.range(0.14, 0.24);
      return { lat: rng.range(-0.55, 0.55), lon: rng.range(0, TAU), a, b: a * rng.range(0.45, 0.6) };
    });
    const bands = new Rng(derive(seed, 'bands'));
    this.bandCount = r.bands.count * bands.range(0.65, 1.35) * lod.bands;
    this.bandTurbulence = r.bands.turbulence * bands.range(0.6, 1.4);
    this.bandShift = bands.range(0, 2);
    this.craterSeeds = [derive(seed, 'craters', 0), derive(seed, 'craters', 1)];
    this.craterLayers = craterLayers;
  }

  /** Normalised terrain height in [0, 1]. */
  private heightAt(x: number, y: number, z: number): number {
    const h = (this.terrain.sample(x, y, z) - this.lo) / this.range;
    return h < 0 ? 0 : h > 1 ? 1 : h;
  }

  /** Classifies the point (x, y, z) of the unit sphere into this.code and this.height (relief). */
  classify(x: number, y: number, z: number): void {
    const r = this.recipe;
    switch (r.surface.kind) {
      case 'bands':
        this.bands(x, y, z);
        return;
      case 'craters':
        this.terrainAt(x, y, z);
        this.craters(x, y, z);
        return;
      default:
        this.terrainAt(x, y, z);
    }
  }

  private terrainAt(x: number, y: number, z: number): void {
    const r = this.recipe;
    const h = this.heightAt(x, y, z);
    const sea = r.levels.sea;
    const above = h - sea;
    this.height = above > 0 ? above * r.relief : 0;
    const polar = (z < 0 ? -z : z) + (above > 0 ? above * r.caps.heightBias : 0);
    if (r.caps.size > 0 && polar > 1 - r.caps.size) {
      this.code = M.cap;
    } else if (h < sea - r.levels.shallows) {
      this.code = M.liquid;
    } else if (h < sea) {
      this.code = M.shallows;
    } else if (this.cracks !== null && Math.abs(this.cracks.sample(x, y, z)) < r.levels.cracks * 0.5) {
      this.code = M.crack;
      this.height = 0;
    } else {
      this.code = h >= r.levels.high ? M.highland : M.lowland;
    }
  }

  private bands(x: number, y: number, z: number): void {
    this.height = 0;
    // Zonal flow: the wobble is stretched along the parallels.
    const wobble = this.terrain.sample(x, y, z * 3);
    // Bands narrow towards the poles (z^3 term) like on real giants.
    const lat = z + 0.25 * z * z * z;
    const b = (lat + this.bandTurbulence * 0.25 * wobble) * this.bandCount + this.bandShift;
    const v = 0.5 + 0.5 * sin(b * PI);
    this.code = v < 0.3 ? M.bandDark : v < 0.7 ? M.bandMid : M.bandLight;
    if (this.storms.length === 0) return;
    const phi = asin(z);
    const lon = atan2(y, x);
    for (const s of this.storms) {
      let dl = lon - s.lon;
      dl -= TAU * Math.floor((dl + PI) / TAU);
      const u = (dl * cos(phi)) / s.a;
      const w = (phi - s.lat) / s.b;
      const e = u * u + w * w;
      if (e < 1) {
        this.code = e < 0.45 ? M.storm : M.bandDark;
        return;
      }
    }
  }

  private craters(x: number, y: number, z: number): void {
    const r = this.recipe;
    for (let layer = 0; layer < this.craterLayers; layer++) {
      const f = r.craters.density * (layer === 0 ? 1 : 2.7);
      worley3(this.craterSeeds[layer], x * f, y * f, z * f, this.cell);
      const id = this.cell.cell;
      if ((id & 0xff) < 40) continue; // about one cell in six holds no crater
      const radius = r.craters.size * 0.5 * (0.6 + 0.4 * ((mix32(id) & 0xffff) / 65536));
      const d = this.cell.f1 / radius;
      if (d >= 1) continue;
      const depth = r.craters.depth * 0.12 * (layer === 0 ? 1 : 0.5);
      if (d < 0.72) {
        this.code = M.craterFloor;
        this.height -= depth * (1 - d * d);
      } else {
        this.code = M.craterRim;
        this.height += depth * 0.5;
      }
    }
  }

  /** Is the sky cloudy at this point of the (cloud-rotated) sphere? */
  cloudy(x: number, y: number, z: number): boolean {
    if (this.clouds === null) return false;
    return (this.clouds.sample(x, y, z) - this.cloudLo) / this.cloudRange > this.cloudThreshold;
  }
}

export interface SurfaceMap {
  readonly w: number;
  readonly h: number;
  readonly codes: Uint8Array;
  readonly heights: Float32Array;
  readonly clouds: Uint8Array;
}

/**
 * Equirectangular maps, 2h x h: cell (i, j) is longitude (i + 0.5) / w turns, latitude from
 * north to south. `smooth` runs the majority filter (for renders); descriptor maps stay raw so
 * small features like craters keep their true share.
 */
export function buildMaps(model: PlanetModel, h: number, smooth: boolean): SurfaceMap {
  const w = 2 * h;
  const codes = new Uint8Array(w * h);
  const heights = new Float32Array(w * h);
  const clouds = new Uint8Array(w * h);
  // Longitudes are the same on every row: their sines and cosines once per column.
  const cosLon = new Float64Array(w);
  const sinLon = new Float64Array(w);
  for (let i = 0; i < w; i++) {
    const lon = ((i + 0.5) / w) * TAU;
    cosLon[i] = cos(lon);
    sinLon[i] = sin(lon);
  }
  for (let j = 0; j < h; j++) {
    const lat = PI / 2 - ((j + 0.5) / h) * PI;
    const cl = cos(lat);
    const z = sin(lat);
    for (let i = 0; i < w; i++) {
      const x = cl * cosLon[i];
      const y = cl * sinLon[i];
      model.classify(x, y, z);
      codes[j * w + i] = model.code;
      heights[j * w + i] = model.height;
      clouds[j * w + i] = model.cloudy(x, y, z) ? 1 : 0;
    }
  }
  if (!smooth) return { w, h, codes, heights, clouds };
  let land: Uint8Array = codes;
  let sky: Uint8Array = clouds;
  for (let pass = 0; pass < 2; pass++) {
    land = smoothCodes(land, w, h, M.crack);
    sky = smoothCodes(sky, w, h, -1);
  }
  // Cells that became liquid lose their relief.
  for (let k = 0; k < land.length; k++) if (land[k] !== codes[k] && LIQUIDS.has(land[k])) heights[k] = 0;
  return { w, h, codes: land, heights, clouds: sky };
}

/**
 * Majority filter on the map codes, wrapping in longitude: a cell takes the code shared by at
 * least 5 of its 8 neighbours. Compacts regions and smooths coasts in map space, so the result
 * is stable while the planet turns. `locked` codes (thin features like cracks) never change.
 */
function smoothCodes(codes: Uint8Array, w: number, h: number, locked: number): Uint8Array {
  const out = codes.slice();
  const counts = new Uint8Array(256);
  const seen: number[] = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = codes[j * w + i];
      if (c === locked) continue;
      seen.length = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj < 0 ? 0 : j + dj >= h ? h - 1 : j + dj;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const v = codes[jj * w + ((i + di + w) % w)];
          if (counts[v]++ === 0) seen.push(v);
        }
      }
      for (const v of seen) {
        if (v !== c && v !== locked && counts[v] >= 5) out[j * w + i] = v;
        counts[v] = 0;
      }
    }
  }
  return out;
}

/** Area-weighted share of each material code in a map (cells weigh cos(latitude)). */
export function composition(map: SurfaceMap): Record<string, number> {
  const totals = new Float64Array(MATERIAL_NAMES.length);
  let sum = 0;
  for (let j = 0; j < map.h; j++) {
    const weight = cos(PI / 2 - ((j + 0.5) / map.h) * PI);
    for (let i = 0; i < map.w; i++) {
      totals[map.codes[j * map.w + i]] += weight;
      sum += weight;
    }
  }
  const out: Record<string, number> = {};
  MATERIAL_NAMES.forEach((name, code) => {
    if (code > 0 && totals[code] > 0) out[name] = Math.round((totals[code] / sum) * 1000) / 1000;
  });
  return out;
}

/** Share of land (anything that is not liquid) in a map. */
export function landShare(map: SurfaceMap): number {
  let land = 0;
  let sum = 0;
  for (let j = 0; j < map.h; j++) {
    const weight = cos(PI / 2 - ((j + 0.5) / map.h) * PI);
    for (let i = 0; i < map.w; i++) {
      if (!LIQUIDS.has(map.codes[j * map.w + i])) land += weight;
      sum += weight;
    }
  }
  return Math.round((land / sum) * 1000) / 1000;
}

// 64 symbols for compact map strings in descriptors.
const SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';

/** One symbol per cell: material codes as they are, heights quantised to 0..63 over [-0.3, 0.3]. */
export function encodeMap(map: SurfaceMap): { materials: string; heights: string } {
  let materials = '';
  let heights = '';
  for (let i = 0; i < map.codes.length; i++) {
    materials += SYMBOLS[map.codes[i]];
    const q = Math.round(((map.heights[i] + 0.3) / 0.6) * 63);
    heights += SYMBOLS[q < 0 ? 0 : q > 63 ? 63 : q];
  }
  return { materials, heights };
}
