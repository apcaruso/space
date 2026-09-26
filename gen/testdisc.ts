// Test disc: a small rotating world that exercises the whole chain (noise on a sphere,
// materials, clean-up, shading, outline, pixel-perfect corners). Not part of the universe.

import { FloatField, IndexedBuffer } from '../core/buffer';
import { cos, PI, sin, TAU } from '../core/dmath';
import { derive } from '../core/hash';
import { Fbm3, gradientNoise3, Warp3, type Field3 } from '../core/noise';
import { fixCorners, removeOrphans } from '../toolkit/cleanup';
import { outline } from '../toolkit/outline';
import { masterPalette } from '../toolkit/palette';
import { shade } from '../toolkit/shade';
import { defineGenerator } from './registry';
import { bool, choice, int, num, obj, type Infer } from './schema';

const palette = masterPalette();
const RAMPS = palette.ramps.map((r) => r.name);

const recipe = obj({
  land: choice(RAMPS, 'vegetation', 'rampa della terra'),
  sea: choice(RAMPS, 'ocean', 'rampa del mare'),
  seaLevel: num(0, -0.6, 0.6, 'altezza del rumore sulla costa'),
  relief: num(0.12, 0, 0.5, 'rilievo della terra, in frazione del raggio'),
  noise: obj({
    scale: num(1.6, 0.25, 8, 'frequenza del rumore sulla sfera unitaria'),
    octaves: int(4, 1, 8, 'ottave del fbm'),
    gain: num(0.5, 0.2, 0.8, 'guadagno tra ottave'),
    warp: num(0.35, 0, 2, 'domain warp, in dimensioni dei continenti'),
  }),
  period: int(96, 8, 4096, 'frame per una rotazione completa'),
  coastline: bool(false, 'linea interna dove la terra tocca il mare'),
});

type Recipe = Infer<typeof recipe>;

const SEA = 1;
const LAND = 2;
const GOLDEN_ANGLE = PI * (3 - Math.sqrt(5));
const COVERAGE_SAMPLES = 512;

function terrain(r: Recipe, seed: number): Field3 {
  const opts = { octaves: r.noise.octaves, gain: r.noise.gain, frequency: r.noise.scale };
  const base = new Fbm3(gradientNoise3, derive(seed, 'terrain'), opts);
  if (r.noise.warp === 0) return base;
  return new Warp3(base, derive(seed, 'warp'), { amplitude: r.noise.warp / r.noise.scale, octaves: 2, frequency: r.noise.scale });
}

/** Land fraction over evenly spread points of the sphere: independent of size, frame and light. */
function landCoverage(field: Field3, seaLevel: number): number {
  let land = 0;
  for (let i = 0; i < COVERAGE_SAMPLES; i++) {
    const y = 1 - (2 * i + 1) / COVERAGE_SAMPLES;
    const ring = Math.sqrt(1 - y * y);
    const phi = i * GOLDEN_ANGLE;
    if (field.sample(cos(phi) * ring, y, sin(phi) * ring) > seaLevel) land++;
  }
  return land / COVERAGE_SAMPLES;
}

export const testdisc = defineGenerator({
  name: 'testdisc',
  version: 1,
  description: 'disco rotante con continenti di rumore: prova tutta la catena core + toolkit',
  recipe,
  sizes: { default: 48, min: 16, max: 256 },
  loop: 96,
  goldens: [
    { seed: 0 },
    { seed: 1 },
    { seed: 2 },
    { seed: 7, size: 32 },
    { seed: 3, frame: 24 },
    { seed: 4, light: 90 },
    { seed: 5, size: 64, recipe: { land: 'sand', sea: 'magma', coastline: true } },
  ],
  validators: [
    {
      name: 'coverage',
      check(result) {
        const c = result.descriptor.landCoverage as number;
        return c < 0.15 || c > 0.85 ? `la terra copre il ${Math.round(c * 100)}% (serve 15-85%)` : null;
      },
    },
  ],

  generate(r, seed, opts) {
    const { size } = opts;
    const field = terrain(r, seed);
    const radius = size / 2 - 1;
    const centre = size / 2;
    const phase = (((opts.frame % r.period) + r.period) % r.period) / r.period;
    const ca = cos(TAU * phase);
    const sa = sin(TAU * phase);

    const heights = new FloatField(size, size);
    let mats = new IndexedBuffer(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5 - centre) / radius;
        const dy = (y + 0.5 - centre) / radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 1) continue;
        const dz = Math.sqrt(1 - d2);
        // Spin the sphere around the screen's vertical axis.
        const h = field.sample(dx * ca + dz * sa, dy, dz * ca - dx * sa);
        const land = h > r.seaLevel;
        mats.set(x, y, land ? LAND : SEA);
        heights.set(x, y, (dz + (land ? (h - r.seaLevel) * r.relief : 0)) * radius);
      }
    }
    mats = removeOrphans(mats);

    const shaded = shade(heights, mats, [{ ramp: r.sea }, { ramp: r.land }], palette, { light: opts.lightDir });
    const outlined = outline(shaded, palette, { inner: r.coastline });
    const buffer = fixCorners(outlined, palette.darkestIndices());
    const coverage = landCoverage(field, r.seaLevel);
    return {
      buffer,
      descriptor: { radius, landCoverage: Math.round(coverage * 1000) / 1000, rotationPeriod: r.period },
    };
  },
});
