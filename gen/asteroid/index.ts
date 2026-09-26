// Asteroid generator: an irregular silhouette (polar radius modulated by noise on a circle, so
// it closes without a seam), a height field of dome + bumps + craters, lit by the star with
// the same shading as planets, spinning in the image plane.

import { FloatField, IndexedBuffer } from '../../core/buffer';
import { atan2, cos, PI, sin, TAU } from '../../core/dmath';
import { derive, mix32 } from '../../core/hash';
import { createCellSample, Fbm2, gradientNoise2, worley2 } from '../../core/noise';
import { Rng } from '../../core/rng';
import { fixCorners, removeOrphans } from '../../toolkit/cleanup';
import { BAYER2, BAYER4 } from '../../toolkit/dither';
import { outline } from '../../toolkit/outline';
import { masterPalette } from '../../toolkit/palette';
import { shade, type ShadeMaterial } from '../../toolkit/shade';
import { defineGenerator } from '../registry';
import { choice, int, num, obj, type Infer } from '../schema';

const palette = masterPalette();

export const MATERIALS = ['rocky', 'metallic', 'icy', 'crystalline'] as const;
type Material = (typeof MATERIALS)[number];

const recipe = obj({
  material: choice(['auto', ...MATERIALS], 'auto', 'materiale; auto = scelto dal seed'),
  shape: obj({
    lumpiness: num(0.3, 0, 0.7, 'irregolarità del contorno'),
    elongation: num(0.25, 0, 0.7, 'allungamento'),
    detail: num(1.3, 0.5, 4, 'frequenza delle bozze del contorno'),
  }),
  surface: obj({
    bumps: num(0.35, 0, 1, 'rilievo del rumore di superficie'),
    craters: num(0.6, 0, 1, 'profondità dei crateri (0 = nessuno)'),
  }),
  period: int(96, 8, 4096, 'frame per un giro su se stesso'),
});

type Recipe = Infer<typeof recipe>;

/** Base and secondary ramps, and how the secondary material is laid out. */
interface Look {
  base: string;
  second: string;
  /** Share of the surface covered by the secondary material. */
  share: number;
  facets: boolean;
}

function look(material: Material, seed: number): Look {
  switch (material) {
    case 'metallic':
      return { base: 'metal-dark', second: 'metal-light', share: 0.3, facets: false };
    case 'icy':
      return { base: 'ice', second: 'cloud', share: 0.35, facets: false };
    case 'crystalline':
      return { base: 'basalt', second: new Rng(derive(seed, 'crystal')).chance(0.5) ? 'crystal-magenta' : 'crystal-teal', share: 0.45, facets: true };
    default:
      return { base: 'rock', second: 'ash', share: 0.3, facets: false };
  }
}

function resolveAsteroid(input: unknown, seed: number): unknown {
  const obj = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (obj.material !== undefined && obj.material !== 'auto') return input;
  const weights = [4, 2, 2, 1];
  let t = new Rng(derive(seed, 'material')).float() * 9;
  let material: Material = 'rocky';
  for (let i = 0; i < MATERIALS.length; i++) {
    t -= weights[i];
    if (t < 0) {
      material = MATERIALS[i];
      break;
    }
  }
  return { ...obj, material };
}

const CONTOUR_POINTS = 32;

/** Normalised radius of the silhouette at angle `a` (object frame), mean 1 over the circle. */
class Outline {
  private readonly field: Fbm2;
  private readonly r: Recipe;
  private readonly axis: number;
  private readonly lump: number;
  private readonly mean: number;

  constructor(r: Recipe, seed: number, small: boolean) {
    this.r = r;
    // Two octaves at most: potatoes, not stars.
    this.field = new Fbm2(gradientNoise2, derive(seed, 'outline'), { octaves: small ? 1 : 2, gain: 0.4, frequency: 1 });
    this.axis = new Rng(derive(seed, 'axis')).range(0, PI);
    this.lump = r.shape.lumpiness * (small ? 0.6 : 1);
    let sum = 0;
    for (let i = 0; i < 64; i++) sum += this.raw((i / 64) * TAU);
    this.mean = sum / 64;
  }

  private raw(a: number): number {
    const k = this.r.shape.detail;
    const n = this.field.sample(cos(a) * k, sin(a) * k);
    return Math.max(0.45, 1 + this.lump * n + this.r.shape.elongation * cos(2 * (a - this.axis)));
  }

  at(a: number): number {
    return this.raw(a) / this.mean;
  }

  /** Largest radius, for the buffer size. */
  max(): number {
    let m = 0;
    for (let i = 0; i < 64; i++) m = Math.max(m, this.at((i / 64) * TAU));
    return m;
  }
}

export const asteroid = defineGenerator({
  name: 'asteroid',
  version: 1,
  description: 'asteroidi irregolari rocciosi, metallici, ghiacciati o cristallini, in rotazione',
  recipe,
  resolve: resolveAsteroid,
  sizes: { default: 24, min: 6, max: 48 },
  loop: 96,
  light: { azimuth: 290, elevation: 25 },
  goldens: [
    { seed: 0 },
    { seed: 1, recipe: { material: 'metallic' }, frame: 20 },
    { seed: 2, recipe: { material: 'icy' }, size: 12 },
    { seed: 3, recipe: { material: 'crystalline' }, size: 48, frame: 40 },
    { seed: 4, recipe: { material: 'rocky' }, size: 6, light: 90 },
  ],
  validators: [
    {
      name: 'shape',
      check(result) {
        const contour = result.descriptor.contour as number[];
        const ratio = Math.max(...contour) / Math.min(...contour);
        if (ratio < 1.15) return `troppo tondo (rapporto tra raggi ${ratio.toFixed(2)})`;
        if (ratio > 2.6) return `troppo sottile (rapporto tra raggi ${ratio.toFixed(2)})`;
        return null;
      },
    },
  ],

  generate(r: Recipe, seed, opts) {
    const material = r.material as Material;
    const lk = look(material, seed);
    const radius = opts.size / 2;
    const small = opts.size < 12;
    const shape = new Outline(r, seed, small);
    const side = 2 * Math.ceil(radius * shape.max()) + 4;
    const c = side / 2;
    const turns = new Rng(derive(seed, 'spin')).chance(0.5) ? 1 : -1;
    const spin = (turns * TAU * (((opts.frame % r.period) + r.period) % r.period)) / r.period;
    const cs = cos(spin);
    const sn = sin(spin);

    const bumps = new Fbm2(gradientNoise2, derive(seed, 'bumps'), { octaves: small ? 2 : 3, frequency: 1.6 });
    const patches = new Fbm2(gradientNoise2, derive(seed, 'patches'), { octaves: 2, frequency: 1.3 });
    const craterSeed = derive(seed, 'craters');
    const facetSeed = derive(seed, 'facets');
    const craters = small ? 0 : r.surface.craters;
    const cell = createCellSample();

    const heights = new FloatField(side, side);
    const dome = new FloatField(side, side);
    let mats = new IndexedBuffer(side, side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const px = (x + 0.5 - c) / radius;
        const py = (y + 0.5 - c) / radius;
        // Object frame: undo the spin, so shape and surface turn together.
        const u = px * cs + py * sn;
        const v = py * cs - px * sn;
        const d = Math.sqrt(u * u + v * v);
        const edge = shape.at(atan2(v, u));
        if (d >= edge) continue;
        const bulge = Math.sqrt(1 - (d / edge) * (d / edge));
        let h = bulge * 0.9 + r.surface.bumps * 0.25 * bumps.sample(u, v);
        let second = patches.sample(u + 7.3, v - 3.1) > 0.35 - lk.share;
        if (lk.facets) {
          // Crystal facets: each Worley cell is a flat plane with its own tilt.
          worley2(facetSeed, u * 2.2, v * 2.2, cell);
          const tilt = mix32(cell.cell);
          const tx = ((tilt & 0xff) / 255 - 0.5) * 0.9;
          const ty = (((tilt >>> 8) & 0xff) / 255 - 0.5) * 0.9;
          h = bulge * 0.7 + tx * u + ty * v;
          second = ((tilt >>> 16) & 0xff) / 255 < lk.share;
        }
        if (craters > 0) {
          worley2(craterSeed, u * 2.4, v * 2.4, cell);
          const cr = 0.28 + 0.14 * ((mix32(cell.cell) & 0xffff) / 65536);
          if ((cell.cell & 0xff) > 90 && cell.f1 < cr) {
            const q = cell.f1 / cr;
            h += q < 0.75 ? -craters * 0.3 * (1 - q * q) : craters * 0.12;
          }
        }
        heights.set(x, y, h * radius);
        dome.set(x, y, bulge * radius);
        mats.set(x, y, second ? 2 : 1);
      }
    }

    // Lone material pixels (patch specks, single pixels sticking out of the silhouette) go.
    mats = removeOrphans(mats);
    const table: ShadeMaterial[] = [{ ramp: lk.base }, { ramp: lk.second, shadowTone: 2 }];
    const shaded = shade(heights, mats, table, palette, {
      light: opts.lightDir,
      dither: small ? BAYER2 : BAYER4,
      ditherWidth: small ? 0.15 : 0.3,
      shadow: 'space',
      shape: dome,
      levels: 4,
    });
    const buffer = fixCorners(outline(shaded, palette, { ceiling: { lightness: 0.45, index: palette.index('space', 1) } }), palette.darkestIndices());

    const contour = Array.from({ length: CONTOUR_POINTS }, (_, i) => Math.round(shape.at((i / CONTOUR_POINTS) * TAU) * 1000) / 1000);
    return {
      buffer,
      descriptor: {
        material,
        radius,
        centre: [c, c],
        contour,
        rotation: { period: r.period, direction: turns },
      },
    };
  },
});
