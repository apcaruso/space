// Galaxy shape: a density field on the plane (sector units, centre at 0,0) made of an exponential
// disc, a bulge, an optional bar, logarithmic spiral arms bent by a domain warp, clumps, voids
// and rare clusters. The density decides how many systems a sector holds and its character.

import { atan2, cos, exp, log, PI, sin, tan, TAU } from '../core/dmath';
import { derive, mix32 } from '../core/hash';
import { createCellSample, Fbm2, gradientNoise2, worley2, type CellSample } from '../core/noise';
import { Rng } from '../core/rng';

/** Most systems a sector can hold: one per cell of a 4 x 4 grid. */
export const MAX_SYSTEMS = 16;
/** Expected systems per sector at density 1. */
const SYSTEMS_PER_DENSITY = 12;
/** Cluster cells, in sectors. */
const CLUSTER_CELL = 28;
/** Name regions, in sectors. */
const STYLE_CELL = 70;
export const NAME_STYLES = 5;

export interface GalaxyShape {
  /** Disc radius, sectors. */
  readonly radius: number;
  readonly arms: number;
  /** Pitch angle of the arms, radians. */
  readonly pitch: number;
  /** Arm half-width, as a fraction of the spacing between arms. */
  readonly armWidth: number;
  /** Bar half-length in sectors (0 = no bar) and its angle. */
  readonly bar: number;
  readonly barAngle: number;
  /** Bulge radius, sectors. */
  readonly core: number;
  /** Disc scale length, sectors. */
  readonly scale: number;
  readonly rotation: number;
  /** Winding direction of the arms, 1 or -1. */
  readonly winding: number;
}

export interface SectorInfo {
  readonly sx: number;
  readonly sy: number;
  readonly seed: number;
  readonly density: number;
  /** Systems in the sector, 0..16; system indices are 0..count-1. */
  readonly count: number;
  /** Stellar population age, 0 young .. 1 old. */
  readonly age: number;
  /** Nebula amount 0..1 and its colours (palette ramps). */
  readonly nebula: number;
  readonly nebulaRamp: string;
  readonly accentRamp: string;
  /** Background star density 0..3 and distant galaxies 0..3. */
  readonly stars: number;
  readonly galaxies: number;
  /** Name style (language) of the region, 0..NAME_STYLES-1. */
  readonly style: number;
}

/** Character of a point of the galaxy; `core` and `hue` decide the nebula colours. */
export interface Character {
  readonly density: number;
  readonly core: number;
  readonly hue: number;
  readonly age: number;
  readonly nebula: number;
  readonly nebulaRamp: string;
  readonly accentRamp: string;
}

/** Nebula colours: warm dust near the core, violet, magenta or teal emission in the disc. */
export function nebulaRamps(core: number, hue: number): [string, string] {
  if (core > 0.35) return ['gas-warm', 'magma'];
  if (hue < -0.15) return ['crystal-magenta', 'gas-violet'];
  if (hue > 0.18) return ['crystal-teal', 'gas-cold'];
  return ['gas-violet', 'ocean'];
}

/** Density and the terms the sector character is made of. */
export interface DensitySample {
  readonly density: number;
  /** How close to the centre of an arm, 0..1. */
  readonly arm: number;
  /** How close to the bulge, 0..1. */
  readonly core: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export class Galaxy {
  readonly seed: number;
  readonly shape: GalaxyShape;
  private readonly warpX: Fbm2;
  private readonly warpY: Fbm2;
  private readonly clumps: Fbm2;
  private readonly voids: Fbm2;
  private readonly hue: Fbm2;
  private readonly clusterSeed: number;
  private readonly styleSeed: number;
  private readonly armStart: number;
  private readonly cotPitch: number;
  private readonly cell: CellSample = createCellSample();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const shapeSeed = derive(this.seed, 'shape');
    const rng = new Rng(shapeSeed);
    const radius = rng.range(180, 240);
    const hasBar = rng.chance(0.55);
    this.shape = {
      radius,
      arms: rng.int(2, 4),
      pitch: (rng.range(11, 20) * PI) / 180,
      armWidth: rng.range(0.12, 0.19),
      bar: hasBar ? rng.range(0.12, 0.22) * radius : 0,
      barAngle: rng.range(0, PI),
      core: rng.range(0.07, 0.1) * radius,
      scale: rng.range(0.28, 0.36) * radius,
      rotation: rng.range(0, TAU),
      winding: rng.chance(0.5) ? 1 : -1,
    };
    const s = this.shape;
    this.armStart = Math.max(s.bar, s.core * 1.5);
    this.cotPitch = 1 / tan(s.pitch);
    const warpFreq = 1 / (0.2 * radius);
    this.warpX = new Fbm2(gradientNoise2, derive(shapeSeed, 'warp', 'x'), { octaves: 3, frequency: warpFreq });
    this.warpY = new Fbm2(gradientNoise2, derive(shapeSeed, 'warp', 'y'), { octaves: 3, frequency: warpFreq });
    this.clumps = new Fbm2(gradientNoise2, derive(shapeSeed, 'clumps'), { octaves: 4, frequency: 1 / 10 });
    this.voids = new Fbm2(gradientNoise2, derive(shapeSeed, 'voids'), { octaves: 3, frequency: 1 / 45 });
    this.hue = new Fbm2(gradientNoise2, derive(shapeSeed, 'hue'), { octaves: 2, frequency: 1 / 60 });
    this.clusterSeed = derive(shapeSeed, 'clusters');
    this.styleSeed = derive(this.seed, 'names');
  }

  /** Density at a global point (sector units): about 1 in the bulge, near 0 outside the disc. */
  sample(gx: number, gy: number): DensitySample {
    const s = this.shape;
    const R = s.radius;
    const r = Math.sqrt(gx * gx + gy * gy);

    const bulge = exp(-(r / s.core) * (r / s.core));
    let bar = 0;
    if (s.bar > 0) {
      const c = cos(s.barAngle);
      const n = sin(s.barAngle);
      const u = (gx * c + gy * n) / s.bar;
      const v = (gy * c - gx * n) / (s.bar * 0.3);
      bar = 0.7 * exp(-(u * u + v * v));
    }

    // Arms on warped coordinates, so they bend and fray instead of being perfect spirals.
    const amp = 0.06 * R;
    const wx = gx + amp * this.warpX.sample(gx, gy);
    const wy = gy + amp * this.warpY.sample(gx + 31.7, gy - 17.3);
    const wr = Math.sqrt(wx * wx + wy * wy);
    const theta = atan2(wy, wx);
    const wind = s.winding * this.cotPitch * log(Math.max(wr, this.armStart * 0.5) / this.armStart);
    const phase = ((theta - s.rotation - wind) * s.arms) / TAU;
    const q = (phase - Math.round(phase)) / s.armWidth;
    const arm = exp(-q * q) * smoothstep(this.armStart * 0.6, this.armStart * 1.4, wr);

    const edge = 1 - smoothstep(0.82 * R, 1.08 * R, r);
    const disc = exp(-r / s.scale) * edge;
    const clumps = 0.6 + 1.3 * this.clumps.sample(gx, gy);
    const voids = smoothstep(-0.42, -0.2, this.voids.sample(gx, gy));
    const structure = disc * (0.22 + 1.7 * arm) * Math.max(0.08, clumps) * voids;

    let cluster = 0;
    if (r < 1.25 * R) {
      const cell = worley2(this.clusterSeed, gx / CLUSTER_CELL, gy / CLUSTER_CELL, this.cell);
      const h = mix32(cell.cell);
      if ((h & 0xff) < 16) {
        const sigma = (1.2 + ((h >>> 8) & 0xff) / 128) / CLUSTER_CELL;
        const strength = 0.5 + ((h >>> 16) & 0xff) / 300;
        cluster = strength * exp(-(cell.f1 / sigma) * (cell.f1 / sigma));
      }
    }

    const halo = 0.004 * exp(-r / (0.5 * R));
    const density = bulge + bar + structure + cluster + halo;
    return { density, arm: arm * edge, core: clamp01(bulge + bar) };
  }

  density(gx: number, gy: number): number {
    return this.sample(gx, gy).density;
  }

  sectorSeed(sx: number, sy: number): number {
    return derive(this.seed, 'sector', sx, sy);
  }

  /** Character of the galaxy at any point: continuous, so maps can draw it below sector size. */
  character(gx: number, gy: number): Character {
    const d = this.sample(gx, gy);
    const n = this.clumps.sample(gx * 0.37 + 11, gy * 0.37 - 5);
    const arm = d.arm * (1 - d.core);
    const hue = this.hue.sample(gx, gy);
    const [nebulaRamp, accentRamp] = nebulaRamps(d.core, hue);
    return {
      density: d.density,
      core: d.core,
      hue,
      age: clamp01(0.72 - 0.75 * arm + 0.3 * d.core + 0.15 * n),
      nebula: clamp01(arm * (0.55 + 0.9 * n) + 0.4 * d.core * (0.5 + n)),
      nebulaRamp,
      accentRamp,
    };
  }

  /** Number of systems and character of a sector. Needs nothing but the galaxy seed. */
  sector(sx: number, sy: number): SectorInfo {
    const seed = this.sectorSeed(sx, sy);
    const cx = sx + 0.5;
    const cy = sy + 0.5;
    const c = this.character(cx, cy);

    // Binomial over the 16 cells: bounded, and its mean follows the density.
    const p = Math.min(1, (c.density * SYSTEMS_PER_DENSITY) / MAX_SYSTEMS);
    const rng = new Rng(derive(seed, 'count'));
    let count = 0;
    for (let i = 0; i < MAX_SYSTEMS; i++) if (rng.float() < p) count++;

    const cell = worley2(this.styleSeed, cx / STYLE_CELL, cy / STYLE_CELL, this.cell);
    return {
      sx,
      sy,
      seed,
      density: round3(c.density),
      count,
      age: round3(c.age),
      nebula: round3(c.nebula),
      nebulaRamp: c.nebulaRamp,
      accentRamp: c.accentRamp,
      stars: round3(Math.min(3, 0.3 + 2 * c.density)),
      galaxies: round3(Math.min(2, Math.max(0.3, 1.6 - 2 * c.density))),
      style: mix32(cell.cell) % NAME_STYLES,
    };
  }
}

/** Parameters of the background generator's `region` for a sector. */
export function backgroundRegion(info: SectorInfo): Record<string, number | string> {
  return {
    stars: info.stars,
    nebula: info.nebula,
    nebulaRamp: info.nebulaRamp,
    accentRamp: info.accentRamp,
    galaxies: info.galaxies,
  };
}
