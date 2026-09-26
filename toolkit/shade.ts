// Height field + material per pixel -> shaded, dithered palette indices.

import { FloatField, IndexedBuffer, TRANSPARENT } from '../core/buffer';
import { BAYER4, bayerThreshold, type BayerMatrix } from './dither';
import { lightValue, quantizeLevel, type LevelOptions, type Vec3 } from './light';
import type { Palette } from './palette';

export interface ShadeMaterial {
  /** Ramp name in the palette. */
  ramp: string;
  /** Lowest light level: emissive materials keep glowing on the shadow side. Default 0. */
  emissive?: number;
  /**
   * Brightness of the material in light levels, added on the lit side only (the shadow side
   * stays flat): +1 for a light band or a crater rim, -1 for a dark one. Default 0.
   */
  albedo?: number;
  /** Tone of the shadow ramp this material takes on the shadow side (see ShadeOptions.shadow). Default 1. */
  shadowTone?: number;
}

export interface ShadeOptions {
  /** Unit direction towards the light. */
  light: Vec3;
  /** Light levels, default 4; capped by the tones each ramp offers. */
  levels?: number;
  terminator?: number;
  ambient?: number;
  /** Bayer matrix, or null for hard bands. Default BAYER4. */
  dither?: BayerMatrix | null;
  /** Width of the dithered band around each level boundary, 0..1. Default 0.3. */
  ditherWidth?: number;
  /** Multiplies height differences before building normals. Default 1. */
  heightScale?: number;
  /** Keep each ramp's darkest tone for outlines: light levels use tones 1..n-1. Default true. */
  reserveDarkest?: boolean;
  /**
   * Ramp for the shadow side: non-emissive materials leave their own ramp there and take a dark
   * tone of this one, so the night side of a planet goes dark even for clouds and ice.
   */
  shadow?: string;
  /**
   * Heights of the underlying shape (a sphere without relief). When given, the shadow side is
   * decided on it, so relief never scatters lit pixels into the night; relief still shades the
   * lit side.
   */
  shape?: FloatField;
}

/** The smaller of two slopes when they agree in sign, else 0: keeps creases sharp. */
function minmod(a: number, b: number): number {
  if (a > 0 && b > 0) return a < b ? a : b;
  if (a < 0 && b < 0) return a > b ? a : b;
  return 0;
}

/** Does the surface described by `field` face the light at (x, y)? */
function facesLight(field: FloatField, x: number, y: number, scale: number, opts: ShadeOptions): boolean {
  const hc = field.get(x, y);
  const dx = minmod(hc - field.get(x - 1, y), field.get(x + 1, y) - hc) * scale;
  const dy = minmod(hc - field.get(x, y - 1), field.get(x, y + 1) - hc) * scale;
  return -dx * opts.light.x - dy * opts.light.y + opts.light.z > (opts.terminator ?? 0) * Math.sqrt(dx * dx + dy * dy + 1);
}

// Pixels on each side that must continue a gradient for the pixel to be dithered.
const SMOOTH_REACH = 2;

/**
 * Is the light strictly monotonic through the pixel over SMOOTH_REACH pixels on each side,
 * along x or y? True on curved surfaces; false on flat faces, at creases (a single in-between
 * pixel), at light peaks and next to empty pixels (NaN never compares).
 */
function smooth(values: Float64Array, w: number, h: number, x: number, y: number): boolean {
  return monotonic(values, y * w + x, 1, x, w) || monotonic(values, y * w + x, w, y, h);
}

function monotonic(values: Float64Array, i: number, stride: number, pos: number, size: number): boolean {
  if (pos < SMOOTH_REACH || pos >= size - SMOOTH_REACH) return false;
  const first = values[i - stride * SMOOTH_REACH];
  const up = values[i - stride * (SMOOTH_REACH - 1)] > first;
  let prev = first;
  for (let k = -SMOOTH_REACH + 1; k <= SMOOTH_REACH; k++) {
    const v = values[i + k * stride];
    if (up ? !(v > prev) : !(v < prev)) return false;
    prev = v;
  }
  return true;
}

/**
 * Shades a sprite. `materials` holds, per pixel, 0 for empty or k for `table[k - 1]`.
 *
 * - Normals come from the heights (pixel units, towards the viewer) with a minmod limiter: of
 *   the forward and backward differences the gentler one wins, so a crease between a flat top
 *   and a bevel stays a clean edge instead of a row of in-between normals.
 * - Each light level maps evenly onto the tones of the pixel's ramp.
 * - Dithering uses the sprite's own pixel coordinates, and only where the light changes
 *   smoothly through the pixel: flat faces and creases stay solid, curved surfaces blend.
 */
export function shade(
  heights: FloatField,
  materials: IndexedBuffer,
  table: readonly ShadeMaterial[],
  palette: Palette,
  opts: ShadeOptions,
): IndexedBuffer {
  const { w, h } = materials;
  if (heights.w !== w || heights.h !== h) throw new RangeError('shade: heights and materials differ in size');
  if (opts.shape !== undefined && (opts.shape.w !== w || opts.shape.h !== h)) throw new RangeError('shade: shape and materials differ in size');
  const matrix = opts.dither === undefined ? BAYER4 : opts.dither;
  const width = opts.ditherWidth ?? 0.3;
  const scale = opts.heightScale ?? 1;
  const reserve = (opts.reserveDarkest ?? true) ? 1 : 0;

  const ramps = table.map((m) => palette.ramp(m.ramp).indices);
  const albedos = table.map((m) => m.albedo ?? 0);
  const shadowRamp = opts.shadow === undefined ? null : palette.ramp(opts.shadow);
  const shadowIndex = table.map((m) => (shadowRamp === null || (m.emissive ?? 0) > 0 ? 0 : palette.index(shadowRamp, m.shadowTone ?? 1)));
  const levelOpts: LevelOptions[] = table.map((m, k) => {
    const levels = Math.max(2, Math.min(opts.levels ?? 4, ramps[k].length - reserve));
    return {
      levels,
      terminator: opts.terminator,
      ambient: Math.min(opts.ambient ?? 0, levels - 1),
      minLevel: Math.min(m.emissive ?? 0, levels - 1),
    };
  });

  // Pass 1: continuous light level per pixel (NaN where empty), and which pixels face away.
  const values = new Float64Array(w * h).fill(NaN);
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const code = materials.data[y * w + x];
      if (code === TRANSPARENT) continue;
      if (code > table.length) throw new RangeError(`shade: material ${code} has no entry in the table`);
      const hc = heights.get(x, y);
      const dx = minmod(hc - heights.get(x - 1, y), heights.get(x + 1, y) - hc) * scale;
      const dy = minmod(hc - heights.get(x, y - 1), heights.get(x, y + 1) - hc) * scale;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = 1 / len;
      let v = lightValue(nx, ny, nz, opts.light, levelOpts[code - 1]);
      const lit = opts.shape === undefined ? nx * opts.light.x + ny * opts.light.y + nz * opts.light.z > (opts.terminator ?? 0) : facesLight(opts.shape, x, y, scale, opts);
      if (lit) v += albedos[code - 1];
      else dark[y * w + x] = 1;
      values[y * w + x] = v;
    }
  }

  // Pass 2: quantise, dithering only smooth gradients, and map levels to ramp tones.
  const out = new IndexedBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const code = materials.data[i];
      if (code === TRANSPARENT) continue;
      if (dark[i] === 1 && shadowIndex[code - 1] !== 0) {
        out.data[i] = shadowIndex[code - 1];
        continue;
      }
      const lo = levelOpts[code - 1];
      const dithered = matrix !== null && smooth(values, w, h, x, y);
      const threshold = dithered ? bayerThreshold(matrix, x, y) : 0.5;
      const level = quantizeLevel(values[i], lo, threshold, width);
      const tones = ramps[code - 1];
      const tone = reserve + Math.round((level * (tones.length - 1 - reserve)) / (lo.levels - 1));
      out.data[i] = tones[tone];
    }
  }
  return out;
}
