// Lattice noise built on hashCoords: no permutation tables, no state, unbounded domain.
// Every function is allocation-free per sample. Output ranges are documented per function and
// checked in noise.test.ts.

import { derive, hashCoords, hashStageX, hashStageY, hashStageZ, mix32 } from './hash';

export type Noise2 = (seed: number, x: number, y: number) => number;
export type Noise3 = (seed: number, x: number, y: number, z: number) => number;

/** Anything that can be sampled: fbm, domain warps, and user fields. */
export interface Field2 {
  sample(x: number, y: number): number;
}
export interface Field3 {
  sample(x: number, y: number, z: number): number;
}

const INV_2_32 = 1 / 4294967296;

/** Quintic fade 6t^5 - 15t^4 + 10t^3: C2-continuous interpolation. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Lattice value in [-1, 1). */
function latticeValue(h: number): number {
  return h * (2 * INV_2_32) - 1;
}

// --- value noise ---------------------------------------------------------------------------

/** 2D value noise. Range [-1, 1]. */
export function valueNoise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const hx0 = hashStageX(seed, xi);
  const hx1 = hashStageX(seed, xi + 1);
  const v00 = latticeValue(hashStageZ(hashStageY(hx0, yi), 0));
  const v10 = latticeValue(hashStageZ(hashStageY(hx1, yi), 0));
  const v01 = latticeValue(hashStageZ(hashStageY(hx0, yi + 1), 0));
  const v11 = latticeValue(hashStageZ(hashStageY(hx1, yi + 1), 0));
  const a = v00 + u * (v10 - v00);
  const b = v01 + u * (v11 - v01);
  return a + v * (b - a);
}

/** 3D value noise. Range [-1, 1]. */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const hx0 = hashStageX(seed, xi);
  const hx1 = hashStageX(seed, xi + 1);
  const h00 = hashStageY(hx0, yi);
  const h10 = hashStageY(hx1, yi);
  const h01 = hashStageY(hx0, yi + 1);
  const h11 = hashStageY(hx1, yi + 1);
  const v000 = latticeValue(hashStageZ(h00, zi));
  const v100 = latticeValue(hashStageZ(h10, zi));
  const v010 = latticeValue(hashStageZ(h01, zi));
  const v110 = latticeValue(hashStageZ(h11, zi));
  const v001 = latticeValue(hashStageZ(h00, zi + 1));
  const v101 = latticeValue(hashStageZ(h10, zi + 1));
  const v011 = latticeValue(hashStageZ(h01, zi + 1));
  const v111 = latticeValue(hashStageZ(h11, zi + 1));
  const a0 = v000 + u * (v100 - v000);
  const b0 = v010 + u * (v110 - v010);
  const a1 = v001 + u * (v101 - v001);
  const b1 = v011 + u * (v111 - v011);
  const c0 = a0 + v * (b0 - a0);
  const c1 = a1 + v * (b1 - a1);
  return c0 + w * (c1 - c0);
}

// --- gradient noise ------------------------------------------------------------------------

// 2D: eight unit gradients. The tight bound of the raw sum is 1/sqrt(2), reached at the cell
// centre, so scaling by sqrt(2) gives exactly [-1, 1].
const G2X = new Float64Array([1, -1, 0, 0, 0.7071067811865476, -0.7071067811865476, 0.7071067811865476, -0.7071067811865476]);
const G2Y = new Float64Array([0, 0, 1, -1, 0.7071067811865476, 0.7071067811865476, -0.7071067811865476, -0.7071067811865476]);
const GRAD2_SCALE = 1.4142135623730951;

// 3D: Perlin's twelve cube edges, padded to sixteen. The tight bound of the raw sum is
// 1.0363538 (numerical maximisation over the cell); dividing by a value just above it keeps
// the result in [-1, 1].
const G3X = new Float64Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0]);
const G3Y = new Float64Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, 1, -1, -1]);
const G3Z = new Float64Array([0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 1, -1]);
const GRAD3_SCALE = 1 / 1.036354;

function grad2(h: number, dx: number, dy: number): number {
  const i = h & 7;
  return G2X[i] * dx + G2Y[i] * dy;
}

function grad3(h: number, dx: number, dy: number, dz: number): number {
  const i = h & 15;
  return G3X[i] * dx + G3Y[i] * dy + G3Z[i] * dz;
}

/** 2D gradient (Perlin-style) noise. Range [-1, 1]; zero at every lattice point. */
export function gradientNoise2(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fade(fx);
  const v = fade(fy);
  const hx0 = hashStageX(seed, xi);
  const hx1 = hashStageX(seed, xi + 1);
  const n00 = grad2(hashStageZ(hashStageY(hx0, yi), 0), fx, fy);
  const n10 = grad2(hashStageZ(hashStageY(hx1, yi), 0), fx - 1, fy);
  const n01 = grad2(hashStageZ(hashStageY(hx0, yi + 1), 0), fx, fy - 1);
  const n11 = grad2(hashStageZ(hashStageY(hx1, yi + 1), 0), fx - 1, fy - 1);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * GRAD2_SCALE;
}

/** 3D gradient (Perlin-style) noise. Range [-1, 1]; zero at every lattice point. */
export function gradientNoise3(seed: number, x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const hx0 = hashStageX(seed, xi);
  const hx1 = hashStageX(seed, xi + 1);
  const h00 = hashStageY(hx0, yi);
  const h10 = hashStageY(hx1, yi);
  const h01 = hashStageY(hx0, yi + 1);
  const h11 = hashStageY(hx1, yi + 1);
  const n000 = grad3(hashStageZ(h00, zi), fx, fy, fz);
  const n100 = grad3(hashStageZ(h10, zi), fx - 1, fy, fz);
  const n010 = grad3(hashStageZ(h01, zi), fx, fy - 1, fz);
  const n110 = grad3(hashStageZ(h11, zi), fx - 1, fy - 1, fz);
  const n001 = grad3(hashStageZ(h00, zi + 1), fx, fy, fz - 1);
  const n101 = grad3(hashStageZ(h10, zi + 1), fx - 1, fy, fz - 1);
  const n011 = grad3(hashStageZ(h01, zi + 1), fx, fy - 1, fz - 1);
  const n111 = grad3(hashStageZ(h11, zi + 1), fx - 1, fy - 1, fz - 1);
  const a0 = n000 + u * (n100 - n000);
  const b0 = n010 + u * (n110 - n010);
  const a1 = n001 + u * (n101 - n001);
  const b1 = n011 + u * (n111 - n011);
  const c0 = a0 + v * (b0 - a0);
  const c1 = a1 + v * (b1 - a1);
  return (c0 + w * (c1 - c0)) * GRAD3_SCALE;
}

// --- fbm -----------------------------------------------------------------------------------

export interface FbmOptions {
  /** Number of octaves, default 5. */
  octaves?: number;
  /** Frequency multiplier between octaves, default 2. */
  lacunarity?: number;
  /** Amplitude multiplier between octaves, default 0.5. */
  gain?: number;
  /** Frequency of the first octave, default 1. */
  frequency?: number;
}

/**
 * Per-octave tables shared by Fbm2 and Fbm3. Each octave gets its own derived seed and a
 * lattice offset, so octaves never share a lattice point at the origin.
 */
class OctaveTable {
  readonly count: number;
  readonly seeds: Uint32Array;
  readonly freqs: Float64Array;
  readonly amps: Float64Array;
  readonly ox: Float64Array;
  readonly oy: Float64Array;
  readonly oz: Float64Array;
  /** 1 / sum of amplitudes: the sum keeps the range of the base noise. */
  readonly norm: number;

  constructor(seed: number, opts: FbmOptions) {
    const octaves = opts.octaves ?? 5;
    const lacunarity = opts.lacunarity ?? 2;
    const gain = opts.gain ?? 0.5;
    if (!Number.isInteger(octaves) || octaves < 1) throw new RangeError(`fbm: octaves must be a positive integer, got ${octaves}`);
    this.count = octaves;
    this.seeds = new Uint32Array(octaves);
    this.freqs = new Float64Array(octaves);
    this.amps = new Float64Array(octaves);
    this.ox = new Float64Array(octaves);
    this.oy = new Float64Array(octaves);
    this.oz = new Float64Array(octaves);
    let freq = opts.frequency ?? 1;
    let amp = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      const s = derive(seed, 'octave', i);
      this.seeds[i] = s;
      this.freqs[i] = freq;
      this.amps[i] = amp;
      this.ox[i] = mix32(s ^ 0x68e31da4) * (256 * INV_2_32);
      this.oy[i] = mix32(s ^ 0xb5297a4d) * (256 * INV_2_32);
      this.oz[i] = mix32(s ^ 0x1b56c4e9) * (256 * INV_2_32);
      total += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    this.norm = 1 / total;
  }
}

/** Fractal sum of a 2D noise. Same range as the base noise ([-1, 1] for the noises above). */
export class Fbm2 implements Field2 {
  private readonly noise: Noise2;
  private readonly t: OctaveTable;

  constructor(noise: Noise2, seed: number, opts: FbmOptions = {}) {
    this.noise = noise;
    this.t = new OctaveTable(seed, opts);
  }

  sample(x: number, y: number): number {
    const t = this.t;
    const noise = this.noise;
    let sum = 0;
    for (let i = 0; i < t.count; i++) {
      const f = t.freqs[i];
      sum += t.amps[i] * noise(t.seeds[i], x * f + t.ox[i], y * f + t.oy[i]);
    }
    return sum * t.norm;
  }
}

/** Fractal sum of a 3D noise. Same range as the base noise ([-1, 1] for the noises above). */
export class Fbm3 implements Field3 {
  private readonly noise: Noise3;
  private readonly t: OctaveTable;

  constructor(noise: Noise3, seed: number, opts: FbmOptions = {}) {
    this.noise = noise;
    this.t = new OctaveTable(seed, opts);
  }

  sample(x: number, y: number, z: number): number {
    const t = this.t;
    const noise = this.noise;
    let sum = 0;
    for (let i = 0; i < t.count; i++) {
      const f = t.freqs[i];
      sum += t.amps[i] * noise(t.seeds[i], x * f + t.ox[i], y * f + t.oy[i], z * f + t.oz[i]);
    }
    return sum * t.norm;
  }
}

// --- domain warp ---------------------------------------------------------------------------

export interface WarpOptions extends FbmOptions {
  /** Maximum displacement, in the source field's units. Default 1. */
  amplitude?: number;
}

/**
 * Samples `source` at coordinates displaced by independent gradient fbm fields, one per axis.
 * Output range is the source's range. Warps compose: a Warp2 is itself a Field2.
 */
export class Warp2 implements Field2 {
  private readonly source: Field2;
  private readonly wx: Fbm2;
  private readonly wy: Fbm2;
  private readonly amplitude: number;

  constructor(source: Field2, seed: number, opts: WarpOptions = {}) {
    this.source = source;
    this.amplitude = opts.amplitude ?? 1;
    this.wx = new Fbm2(gradientNoise2, derive(seed, 'warp', 'x'), opts);
    this.wy = new Fbm2(gradientNoise2, derive(seed, 'warp', 'y'), opts);
  }

  sample(x: number, y: number): number {
    const a = this.amplitude;
    return this.source.sample(x + a * this.wx.sample(x, y), y + a * this.wy.sample(x, y));
  }
}

/** 3D counterpart of Warp2. */
export class Warp3 implements Field3 {
  private readonly source: Field3;
  private readonly wx: Fbm3;
  private readonly wy: Fbm3;
  private readonly wz: Fbm3;
  private readonly amplitude: number;

  constructor(source: Field3, seed: number, opts: WarpOptions = {}) {
    this.source = source;
    this.amplitude = opts.amplitude ?? 1;
    this.wx = new Fbm3(gradientNoise3, derive(seed, 'warp', 'x'), opts);
    this.wy = new Fbm3(gradientNoise3, derive(seed, 'warp', 'y'), opts);
    this.wz = new Fbm3(gradientNoise3, derive(seed, 'warp', 'z'), opts);
  }

  sample(x: number, y: number, z: number): number {
    const a = this.amplitude;
    return this.source.sample(
      x + a * this.wx.sample(x, y, z),
      y + a * this.wy.sample(x, y, z),
      z + a * this.wz.sample(x, y, z),
    );
  }
}

// --- cellular (Worley) ---------------------------------------------------------------------

/** Result of a cellular query, written in place to avoid allocations. */
export interface CellSample {
  /** Distance to the nearest feature point (F1). */
  f1: number;
  /** Distance to the second nearest feature point (F2). F2 - F1 is 0 on cell borders. */
  f2: number;
  /** uint32 id of the nearest feature point's cell, stable across samples. */
  cell: number;
}

export function createCellSample(): CellSample {
  return { f1: 0, f2: 0, cell: 0 };
}

// Neighbour offsets ordered by ring (Chebyshev distance 0..3), each followed by the minimum
// distance of its ring, max(0, r - 1). With jitter <= 1, F2 is at most sqrt(5) in 2D and sqrt(6)
// in 3D, so rings 0..3 make the search exact; per-cell lower bounds and the ring cut-off skip
// almost all of them.
function ringOffsets(dims: 2 | 3): Int8Array {
  const out: number[] = [];
  for (let r = 0; r <= 3; r++) {
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        if (dims === 2) {
          if (Math.max(Math.abs(a), Math.abs(b)) === r) out.push(a, b, Math.max(0, r - 1));
          continue;
        }
        for (let c = -r; c <= r; c++) {
          if (Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) === r) out.push(a, b, c, Math.max(0, r - 1));
        }
      }
    }
  }
  return new Int8Array(out);
}

const RING2 = ringOffsets(2);
const RING3 = ringOffsets(3);

/** Distance from a point at fraction f inside its cell to the cell at offset o along one axis. */
function axisGap(o: number, f: number): number {
  return o > 0 ? o - f : o < 0 ? f - o - 1 : 0;
}

/**
 * 2D Worley noise with Euclidean distance. Writes into `out` and returns it.
 * Ranges with jitter in [0, 1]: f1 in [0, sqrt(2)], f2 in [f1, sqrt(5)].
 */
export function worley2(seed: number, x: number, y: number, out: CellSample, jitter = 1): CellSample {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  let d1 = Infinity;
  let d2 = Infinity;
  let best = 0;
  for (let k = 0; k < RING2.length; k += 3) {
    const ringGap = RING2[k + 2];
    if (ringGap * ringGap >= d2) break;
    const ox = RING2[k];
    const oy = RING2[k + 1];
    const gx = axisGap(ox, fx);
    const gy = axisGap(oy, fy);
    if (gx * gx + gy * gy >= d2) continue;
    const h = hashCoords(seed, xi + ox, yi + oy);
    const dx = ox + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5) - fx;
    const dy = oy + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5) - fy;
    const d = dx * dx + dy * dy;
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = h;
    } else if (d < d2) {
      d2 = d;
    }
  }
  out.f1 = Math.sqrt(d1);
  out.f2 = Math.sqrt(d2);
  out.cell = mix32(best ^ 0x632be5ab);
  return out;
}

/**
 * 3D Worley noise with Euclidean distance. Writes into `out` and returns it.
 * Ranges with jitter in [0, 1]: f1 in [0, sqrt(3)], f2 in [f1, sqrt(6)].
 */
export function worley3(seed: number, x: number, y: number, z: number, out: CellSample, jitter = 1): CellSample {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  let d1 = Infinity;
  let d2 = Infinity;
  let best = 0;
  for (let k = 0; k < RING3.length; k += 4) {
    const ringGap = RING3[k + 3];
    if (ringGap * ringGap >= d2) break;
    const ox = RING3[k];
    const oy = RING3[k + 1];
    const oz = RING3[k + 2];
    const gx = axisGap(ox, fx);
    const gy = axisGap(oy, fy);
    const gz = axisGap(oz, fz);
    if (gx * gx + gy * gy + gz * gz >= d2) continue;
    const h = hashCoords(seed, xi + ox, yi + oy, zi + oz);
    const h2 = mix32(h ^ 0x5bd1e995);
    const dx = ox + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5) - fx;
    const dy = oy + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5) - fy;
    const dz = oz + 0.5 + jitter * ((h2 & 0xffff) / 65536 - 0.5) - fz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < d1) {
      d2 = d1;
      d1 = d;
      best = h;
    } else if (d < d2) {
      d2 = d;
    }
  }
  out.f1 = Math.sqrt(d1);
  out.f2 = Math.sqrt(d2);
  out.cell = mix32(best ^ 0x632be5ab);
  return out;
}
