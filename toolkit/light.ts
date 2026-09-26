// Quantised lighting. Screen coordinates: x right, y down, z towards the viewer.
// A light direction points from the surface towards the light (its star).

import { cos, PI, sin } from '../core/dmath';
import { ditherQuantize } from './dither';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Unit vector; throws on the zero vector. */
export function direction(x: number, y: number, z: number): Vec3 {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len === 0) throw new RangeError('direction: zero vector');
  return { x: x / len, y: y / len, z: z / len };
}

/**
 * Light direction from a compass azimuth (0 = light from the top of the screen, 90 = from the
 * right, clockwise) and an elevation above the image plane, both in degrees.
 */
export function lightFromAngle(azimuthDeg: number, elevationDeg: number): Vec3 {
  const a = (azimuthDeg * PI) / 180;
  const e = (elevationDeg * PI) / 180;
  const h = cos(e);
  return direction(sin(a) * h, -cos(a) * h, sin(e));
}

export interface LevelOptions {
  /** Number of output levels, >= 2. Level 0 is the darkest. */
  levels: number;
  /** n·l at or below which a surface is on the shadow side. Default 0 (the terminator). */
  terminator?: number;
  /** Level of the shadow side (ambient light). Default 0. */
  ambient?: number;
  /** Lowest level any pixel may take: emissive materials glow on the dark side. Default 0. */
  minLevel?: number;
}

/**
 * Continuous level for a unit normal: the shadow side sits in the middle of the `ambient`
 * band (so it never dithers); the lit side spreads n·l over [ambient, levels], so every level
 * gets an equal share of the lit hemisphere.
 */
export function lightValue(nx: number, ny: number, nz: number, light: Vec3, opts: LevelOptions): number {
  const ambient = opts.ambient ?? 0;
  const terminator = opts.terminator ?? 0;
  const i = nx * light.x + ny * light.y + nz * light.z;
  if (i <= terminator) return ambient + 0.5;
  const t = Math.min(1, (i - terminator) / (1 - terminator));
  return ambient + t * (opts.levels - ambient);
}

/** Integer level from a continuous one, dithered by `threshold` (0.5 = none), clamped to the valid range. */
export function quantizeLevel(v: number, opts: LevelOptions, threshold = 0.5, ditherWidth = 1): number {
  const low = Math.max(opts.ambient ?? 0, opts.minLevel ?? 0);
  const level = ditherQuantize(v, threshold, ditherWidth);
  return level < low ? low : level > opts.levels - 1 ? opts.levels - 1 : level;
}

/** Undithered level for a unit normal. */
export function lightLevel(nx: number, ny: number, nz: number, light: Vec3, opts: LevelOptions): number {
  return quantizeLevel(lightValue(nx, ny, nz, light, opts), opts);
}
