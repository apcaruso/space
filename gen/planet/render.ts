// Projection of the planet maps onto a lit disc, plus atmosphere rim and rings.

import { FloatField, IndexedBuffer, TRANSPARENT } from '../../core/buffer';
import { asin, atan2, cos, PI, sin, TAU } from '../../core/dmath';
import { derive } from '../../core/hash';
import { gradientNoise2 } from '../../core/noise';
import { Rng } from '../../core/rng';
import { fixCorners, removeOrphans } from '../../toolkit/cleanup';
import { BAYER2, BAYER4 } from '../../toolkit/dither';
import type { Vec3 } from '../../toolkit/light';
import { outline } from '../../toolkit/outline';
import { masterPalette } from '../../toolkit/palette';
import { shade, type ShadeMaterial } from '../../toolkit/shade';
import type { GenerateOptions } from '../registry';
import { M, type SurfaceMap } from './maps';
import type { PlanetRecipe } from './recipe';

const palette = masterPalette();
/** Outlines never lighter than this; clouds and ice fall back to a dark navy. */
const OUTLINE_CEILING = { lightness: 0.45, index: palette.index('space', 1) };
/** Rings in the planet's shadow take the colour of the night side. */
const RING_SHADOW = palette.index('space', 1);

/** Orientation of the planet: north pole direction and two equatorial axes, in view space. */
export interface Axis {
  /** Screen roll of the pole, degrees (0 = straight up). */
  readonly roll: number;
  /** Lean of the pole towards the viewer, degrees. */
  readonly lean: number;
  readonly pole: Vec3;
  readonly e1: Vec3;
  readonly e2: Vec3;
}

export interface Rings {
  readonly inner: number;
  readonly outer: number;
}

/** Axis and rings decided from the seed: part of the object's identity, like its maps. */
export function orientation(r: PlanetRecipe, seed: number): { axis: Axis; rings: Rings | null } {
  const rng = new Rng(derive(seed, 'axis'));
  const hasRings = new Rng(derive(seed, 'rings')).float() < r.rings.chance;
  const roll = rng.range(-1, 1) * r.axis.roll;
  // Ringed planets lean more, so the rings open into a readable ellipse.
  const lean = hasRings ? (rng.chance(0.5) ? 1 : -1) * rng.range(16, 28) : rng.range(-1, 1) * r.axis.lean;
  const t = (roll * PI) / 180;
  const f = (lean * PI) / 180;
  const pole = { x: sin(t) * cos(f), y: -cos(t) * cos(f), z: sin(f) };
  // e1 = pole x viewer direction, normalised; e2 = pole x e1.
  const len = Math.sqrt(pole.y * pole.y + pole.x * pole.x);
  const e1 = { x: pole.y / len, y: -pole.x / len, z: 0 };
  const e2 = {
    x: pole.y * e1.z - pole.z * e1.y,
    y: pole.z * e1.x - pole.x * e1.z,
    z: pole.x * e1.y - pole.y * e1.x,
  };
  const rings = hasRings ? { inner: r.rings.inner, outer: Math.max(r.rings.outer, r.rings.inner + 0.25) } : null;
  return { axis: { roll: Math.round(roll * 10) / 10, lean: Math.round(lean * 10) / 10, pole, e1, e2 }, rings };
}

function phase(frame: number, period: number): number {
  return (((frame % period) + period) % period) / period;
}

/** Shading table, indexed by material code - 1. */
function materials(r: PlanetRecipe): ShadeMaterial[] {
  const byCode: ShadeMaterial[] = [];
  byCode[M.liquid] = { ramp: r.ramps.liquid, emissive: r.emissive.liquid };
  byCode[M.shallows] = { ramp: r.ramps.shallows, emissive: r.emissive.shallows };
  byCode[M.lowland] = { ramp: r.ramps.lowland };
  byCode[M.highland] = { ramp: r.ramps.highland };
  byCode[M.cap] = { ramp: r.ramps.cap, shadowTone: 2 };
  byCode[M.crack] = { ramp: r.ramps.crack, emissive: r.emissive.crack };
  byCode[M.bandDark] = { ramp: r.ramps.lowland, albedo: -1 };
  byCode[M.bandMid] = { ramp: r.ramps.lowland };
  byCode[M.bandLight] = { ramp: r.ramps.lowland, albedo: 1 };
  byCode[M.storm] = { ramp: r.bands.stormRamp, albedo: 0.5 };
  byCode[M.craterFloor] = { ramp: r.ramps.lowland, albedo: -1 };
  byCode[M.craterRim] = { ramp: r.ramps.lowland, albedo: 1 };
  byCode[M.cloud] = { ramp: r.clouds.ramp, shadowTone: 2 };
  return byCode.slice(1);
}

export interface PlanetImage {
  readonly buffer: IndexedBuffer;
  /** Centre of the disc in buffer pixels. */
  readonly centre: number;
}

/**
 * Draws the planet. `size` is the disc diameter; the buffer adds a 1 px margin for outline
 * and glow, and grows to fit rings.
 */
export function drawPlanet(r: PlanetRecipe, seed: number, map: SurfaceMap, axis: Axis, rings: Rings | null, opts: GenerateOptions): PlanetImage {
  const size = opts.size;
  const radius = size / 2;
  const side = size + 2;
  const c = side / 2;
  const spin = TAU * phase(opts.frame, r.period);
  const cloudSpin = TAU * phase(opts.frame, r.clouds.period);
  const { pole, e1, e2 } = axis;

  const heights = new FloatField(side, side);
  const sphere = new FloatField(side, side);
  let mats = new IndexedBuffer(side, side);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const dx = (x + 0.5 - c) / radius;
      const dy = (y + 0.5 - c) / radius;
      const d2 = dx * dx + dy * dy;
      if (d2 >= 1) continue;
      const dz = Math.sqrt(1 - d2);
      const pa = dx * pole.x + dy * pole.y + dz * pole.z;
      const lat = asin(pa < -1 ? -1 : pa > 1 ? 1 : pa);
      const lon = atan2(dx * e2.x + dy * e2.y + dz * e2.z, dx * e1.x + dy * e1.y + dz * e1.z);
      const row = Math.min(map.h - 1, Math.floor(((PI / 2 - lat) / PI) * map.h));
      const col = Math.floor(phase01((lon + spin) / TAU) * map.w) % map.w;
      const cloudCol = Math.floor(phase01((lon + cloudSpin) / TAU) * map.w) % map.w;
      let code = map.codes[row * map.w + col];
      let relief = map.heights[row * map.w + col];
      if (map.clouds[row * map.w + cloudCol] === 1) {
        code = M.cloud;
        relief = 0.02;
      }
      mats.set(x, y, code);
      heights.set(x, y, (dz + relief) * radius);
      sphere.set(x, y, dz * radius);
    }
  }
  mats = removeOrphans(mats);

  const small = size < 32;
  let sprite = shade(heights, mats, materials(r), palette, {
    light: opts.lightDir,
    dither: small ? BAYER2 : BAYER4,
    ditherWidth: small ? 0.15 : 0.3,
    shadow: 'space',
    shape: sphere,
  });
  if (r.outline) sprite = fixCorners(outline(sprite, palette, { ceiling: OUTLINE_CEILING }), palette.darkestIndices());
  if (r.atmosphere.strength > 0) atmosphere(sprite, r, opts.lightDir, radius, c, size >= 48);

  if (rings === null) return { buffer: sprite, centre: c };
  return withRings(sprite, r, seed, rings, axis, opts, radius);
}

function phase01(t: number): number {
  return t - Math.floor(t);
}

/** Lit-side rim: the outline ring (and, for thick atmospheres, the limb) takes the atmosphere ramp. */
function atmosphere(sprite: IndexedBuffer, r: PlanetRecipe, light: Vec3, radius: number, c: number, limb: boolean): void {
  const ramp = palette.ramp(r.atmosphere.ramp).indices;
  const top = ramp.length - 1;
  const s = r.atmosphere.strength;
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < radius - 1 || d > radius + 1.5) continue;
      // How much the limb at this point faces the light.
      const lit = (dx * light.x + dy * light.y) / d;
      const outside = d >= radius;
      if (outside && sprite.get(x, y) === TRANSPARENT) continue;
      if (outside) {
        if (lit > 0.75 - 0.45 * s) sprite.set(x, y, ramp[lit > 0.85 - 0.3 * s ? top : top - 1]);
      } else if (limb && s >= 0.6 && lit > 0.8 - 0.3 * s) {
        sprite.set(x, y, ramp[top - 1]);
      }
    }
  }
}

/**
 * Rings in the equatorial plane: the half behind the planet is drawn first, the planet over it,
 * then the half in front. The planet's shadow falls on the rings.
 */
function withRings(planet: IndexedBuffer, r: PlanetRecipe, seed: number, rings: Rings, axis: Axis, opts: GenerateOptions, radius: number): PlanetImage {
  const extent = Math.ceil(rings.outer * radius) + 2;
  let side = Math.max(planet.w, 2 * extent);
  if ((side - planet.w) % 2 !== 0) side++;
  const c = side / 2;
  const offset = (side - planet.w) / 2;
  const ramp = palette.ramp(r.rings.ramp).indices;
  const top = ramp.length - 1;
  const { pole } = axis;
  const L = opts.lightDir;
  const bandSeed = derive(seed, 'ring-bands');
  const back = new IndexedBuffer(side, side);
  const front = new IndexedBuffer(side, side);

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const X = (x + 0.5 - c) / radius;
      const Y = (y + 0.5 - c) / radius;
      // Point of the ring plane (normal = pole) seen at this pixel.
      const Z = -(X * pole.x + Y * pole.y) / pole.z;
      const dist = Math.sqrt(X * X + Y * Y + Z * Z);
      if (dist < rings.inner || dist > rings.outer) continue;
      const u = (dist - rings.inner) / (rings.outer - rings.inner);
      // Radial structure: gaps and brighter or darker ringlets.
      const density = gradientNoise2(bandSeed, u * 9, 0.5) + 0.35 * gradientNoise2(bandSeed + 1, u * 23, 0.5);
      if (density < -1 + 2 * r.rings.gaps * 0.55) continue;
      let tone = top - 1 + (density > 0.35 ? 1 : density < -0.2 ? -1 : 0);
      // The face of the rings turned away from the light is darker.
      if ((pole.x * L.x + pole.y * L.y + pole.z * L.z) * pole.z < 0) tone -= 1;
      let index = ramp[Math.max(1, Math.min(top, tone))];
      // Planet shadow: does the ray towards the light hit the unit sphere? Shadowed ring takes
      // the night colour of the planet.
      const t = -(X * L.x + Y * L.y + Z * L.z);
      if (t > 0) {
        const qx = X + t * L.x;
        const qy = Y + t * L.y;
        const qz = Z + t * L.z;
        if (qx * qx + qy * qy + qz * qz < 1) index = RING_SHADOW;
      }
      (Z < 0 ? back : front).set(x, y, index);
    }
  }
  // Ring edges where the density hovers at the threshold leave single pixels: drop them.
  const out = removeOrphans(back);
  out.blit(planet, offset, offset);
  out.blit(removeOrphans(front), 0, 0);
  return { buffer: out, centre: c };
}
