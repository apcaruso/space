// Glow of the galaxy: its density and nebula colours sampled on a world grid (about one sample
// every 8 screen pixels, one grid per octave of zoom), interpolated per pixel and dithered with a
// Bayer matrix anchored to the world. Nothing is scaled, so the glow follows a continuous zoom.

import type { IndexedBuffer } from '../core/buffer';
import { BAYER4, bayerThreshold, ditherQuantize } from '../toolkit/dither';
import { masterPalette } from '../toolkit/palette';
import { NEBULA_RAMPS, nebulaRampIndex, type Galaxy } from '../universe/galaxy';
import { SCREEN_H, SCREEN_W, type Projection } from './camera';

const palette = masterPalette();
const SPACING_PX = 8;

/** Sample: sqrt of density, nebula amount, core weight, hue. */
type Sample = Float32Array;

const rampTones = NEBULA_RAMPS.map(([r]) => palette.ramp(r).indices);
const space = palette.ramp('space').indices;
/** Bayer 4x4 thresholds by (row * 4 + column). */
const BAYER = Float64Array.from({ length: 16 }, (_, k) => bayerThreshold(BAYER4, k % 4, Math.floor(k / 4)));

/** Grid spacing in sectors at a zoom octave: exact powers of two. */
function spacing(level: number): number {
  let w = SPACING_PX;
  for (let l = 0; l < level; l++) w /= 2;
  for (let l = 0; l > level; l--) w *= 2;
  return w;
}

/** Positive modulo for world-anchored matrix coordinates. */
const mod4 = (n: number) => ((n % 4) + 4) % 4;

export class Haze {
  private readonly galaxy: Galaxy;
  private readonly samples = new Map<string, Sample>();
  private readonly limit = 60000;
  /** Samples computed in the last render. */
  computed = 0;
  private last = new Uint8Array(0);
  private lastKey = '';
  private lastComplete = false;
  /** Some sample of the last render was interpolated from a coarser grid. */
  private approximate = false;

  constructor(galaxy: Galaxy) {
    this.galaxy = galaxy;
  }

  /** Canonical key: a point shared by several grids is stored once, under its coarsest grid. */
  private key(level: number, ix: number, iy: number): string {
    let l = level;
    let x = ix;
    let y = iy;
    while (l > -8 && x % 2 === 0 && y % 2 === 0) {
      x /= 2;
      y /= 2;
      l--;
    }
    return `${l}|${x}|${y}`;
  }

  private compute(level: number, ix: number, iy: number): Sample {
    const w = spacing(level);
    const c = this.galaxy.character(ix * w, iy * w);
    return Float32Array.of(Math.sqrt(c.density), c.nebula, c.core, c.hue);
  }

  /** A sample, computed if the budget allows, else interpolated from the coarser grid. */
  private sample(level: number, ix: number, iy: number, budget: { left: number }, depth = 0): Sample {
    const key = this.key(level, ix, iy);
    const hit = this.samples.get(key);
    if (hit !== undefined) return hit;
    if (budget.left > 0 || depth >= 4) {
      budget.left--;
      this.computed++;
      const s = this.compute(level, ix, iy);
      if (this.samples.size >= this.limit) this.samples.delete(this.samples.keys().next().value as string);
      this.samples.set(key, s);
      return s;
    }
    this.approximate = true;
    const x = ix / 2;
    const y = iy / 2;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const a = this.sample(level - 1, x0, y0, budget, depth + 1);
    const b = fx > 0 ? this.sample(level - 1, x0 + 1, y0, budget, depth + 1) : a;
    const c = fy > 0 ? this.sample(level - 1, x0, y0 + 1, budget, depth + 1) : a;
    const d = fx > 0 && fy > 0 ? this.sample(level - 1, x0 + 1, y0 + 1, budget, depth + 1) : fx > 0 ? b : c;
    const out = new Float32Array(4);
    for (let k = 0; k < 4; k++) out[k] = (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (c[k] * (1 - fx) + d[k] * fx) * fy;
    return out;
  }

  /**
   * Draws the glow where the buffer is still `background`. `gain` scales the density, `alpha`
   * (0..1) thins the glow out with a second dither for fading between zoom levels. The result
   * is kept: while the camera and the parameters do not change, it is copied, not recomputed.
   */
  render(fb: IndexedBuffer, proj: Projection, o: { gain: number; alpha: number; budget: number; background: number }): void {
    if (o.alpha <= 0) return;
    this.computed = 0;
    const c = proj.camera.center;
    const key = `${c.sx}|${c.sy}|${c.x}|${c.y}|${proj.camera.z}|${o.gain}|${o.alpha}`;
    if (key === this.lastKey && this.lastComplete) {
      const src = this.last;
      const data = fb.data;
      for (let i = 0; i < data.length; i++) if (src[i] !== 0 && data[i] === o.background) data[i] = src[i];
      return;
    }
    const s = proj.s;
    const level = Math.floor(proj.camera.z);
    const w = spacing(level);
    const cellPx = w * s;
    // World position of the centre of screen pixel (0, 0), and the grid range over the screen.
    const p0 = proj.toWorld(0, 0);
    const gx0 = p0.sx + p0.x;
    const gy0 = p0.sy + p0.y;
    const ix0 = Math.floor(gx0 / w);
    const iy0 = Math.floor(gy0 / w);
    const nx = Math.ceil(SCREEN_W / cellPx) + 2;
    const ny = Math.ceil(SCREEN_H / cellPx) + 2;
    const budget = { left: o.budget };
    this.approximate = false;
    // Samples of the visible grid, channel by channel, in flat arrays.
    const g0 = new Float32Array(nx * ny);
    const g1 = new Float32Array(nx * ny);
    const g2 = new Float32Array(nx * ny);
    const g3 = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v = this.sample(level, ix0 + i, iy0 + j, budget);
        const k = j * nx + i;
        g0[k] = v[0];
        g1[k] = v[1];
        g2[k] = v[2];
        g3[k] = v[3];
      }
    }

    const anchorX = Math.floor(proj.x(c.sx, c.x)) - Math.floor(c.sx * s + c.x * s);
    const anchorY = Math.floor(proj.y(c.sy, c.y)) - Math.floor(c.sy * s + c.y * s);
    const gain = Math.sqrt(o.gain) * 3.4;
    // Below this interpolated value no pixel can reach tone 1, whatever the dither.
    const cutoff = 0.45 / gain;
    const data = fb.data;
    const out = this.last.length === data.length ? this.last : (this.last = new Uint8Array(data.length));
    out.fill(0);
    const inv = 1 / (w * s);
    const u0 = gx0 / w - ix0;
    for (let Y = 0; Y < SCREEN_H; Y++) {
      const v = (gy0 + Y / s) / w - iy0;
      const j = Math.floor(v);
      const fy = v - j;
      const wy = mod4(Y - anchorY);
      const row = j * nx;
      for (let X = 0; X < SCREEN_W; X++) {
        const idx = Y * SCREEN_W + X;
        if (data[idx] !== o.background) continue;
        const u = u0 + X * inv;
        const i = Math.floor(u);
        const fx = u - i;
        const a = row + i;
        const b = a + nx;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const glow = g0[a] * w00 + g0[a + 1] * w10 + g0[b] * w01 + g0[b + 1] * w11;
        if (glow < cutoff) continue;
        const wx = mod4(X - anchorX);
        if (o.alpha < 1 && BAYER[wx * 4 + wy] >= o.alpha) continue;
        const t = BAYER[wy * 4 + wx];
        const tone = ditherQuantize(glow * gain, t, 0.9);
        if (tone <= 0) continue;
        const tt = t - 0.5;
        const core = g2[a] * w00 + g2[a + 1] * w10 + g2[b] * w01 + g2[b + 1] * w11;
        const hue = g3[a] * w00 + g3[a + 1] * w10 + g3[b] * w01 + g3[b + 1] * w11;
        const ramp = nebulaRampIndex(core + tt * 0.15, hue + tt * 0.12);
        let index: number;
        if (ramp === 0) index = rampTones[0][Math.min(3, tone - 1)];
        else if (g1[a] * w00 + g1[a + 1] * w10 + g1[b] * w01 + g1[b + 1] * w11 + tt * 0.15 > 0.3) index = rampTones[ramp][Math.min(2, tone - 1)];
        else index = space[Math.min(3, tone)];
        data[idx] = index;
        out[idx] = index;
      }
    }
    this.lastKey = key;
    // Only an exact glow is worth keeping; an approximate one is refined next frame.
    this.lastComplete = !this.approximate;
  }
}
