// Star generator: an emissive disc with limb darkening and boiling granulation, inside a halo
// whose corona shimmers with palette cycling. No terminator: stars make their own light.

import { IndexedBuffer } from '../../core/buffer';
import { atan2, cos, pow, sin, TAU } from '../../core/dmath';
import { derive } from '../../core/hash';
import { createCellSample, gradientNoise2, worley3 } from '../../core/noise';
import { Rng } from '../../core/rng';
import { BAYER2, BAYER4, bayerThreshold, ditherQuantize } from '../../toolkit/dither';
import { applyTable, masterPalette } from '../../toolkit/palette';
import { defineGenerator } from '../registry';
import { choice, int, num, obj, type Infer } from '../schema';
import { starIdentity } from '../../universe/stars';
import { CLASS_IDS, STAR_CLASSES, starClass } from './classes';

const palette = masterPalette();

const recipe = obj({
  class: choice(['auto', ...CLASS_IDS], 'auto', 'classe spettrale; auto = scelta dal seed'),
  granulation: obj({
    contrast: num(1, 0, 2, 'contrasto dei granuli'),
    pulse: int(48, 8, 4096, 'frame per un battito dei granuli'),
  }),
  corona: obj({
    size: num(1, 0.3, 3, "dimensione dell'alone rispetto a quella tipica della classe"),
    rays: num(0.6, 0, 1.5, 'irregolarità della corona'),
    cycle: int(4, 1, 64, 'frame per passo del palette cycling della corona'),
  }),
  period: int(96, 8, 4096, 'frame per una rotazione'),
});

type Recipe = Infer<typeof recipe>;

function pickClass(seed: number): string {
  const rng = new Rng(derive(seed, 'class'));
  const total = STAR_CLASSES.reduce((sum, c) => sum + c.weight, 0);
  let t = rng.float() * total;
  for (const c of STAR_CLASSES) {
    t -= c.weight;
    if (t < 0) return c.id;
  }
  return STAR_CLASSES[STAR_CLASSES.length - 1].id;
}

function resolveStar(input: unknown, seed: number): unknown {
  const obj = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  if (obj.class !== undefined && obj.class !== 'auto') return input;
  return { ...obj, class: pickClass(seed) };
}

function phase(frame: number, period: number): number {
  return (((frame % period) + period) % period) / period;
}

export const star = defineGenerator({
  name: 'star',
  version: 1,
  description: 'stelle per classe spettrale: granulazione animata, oscuramento al bordo, corona con palette cycling',
  recipe,
  resolve: resolveStar,
  sizes: { default: 32, min: 8, max: 256 },
  loop: 96,
  goldens: [
    { seed: 0 },
    { seed: 1, recipe: { class: 'O' }, frame: 7 },
    { seed: 2, recipe: { class: 'M' }, size: 16 },
    { seed: 3, recipe: { class: 'red-giant' }, size: 64, frame: 30 },
    { seed: 4, recipe: { class: 'neutron' } },
    { seed: 5, recipe: { class: 'G' }, size: 128, frame: 50 },
  ],

  generate(r: Recipe, seed, opts) {
    const cls = starClass(r.class);
    const diameter = Math.max(3, Math.round(opts.size * cls.scale));
    const radius = diameter / 2;
    const haloRadius = Math.max(radius + 2, radius * cls.halo * r.corona.size);
    const margin = Math.ceil(haloRadius * (1 + 0.35 * r.corona.rays) - radius) + 2;
    const side = diameter + 2 * margin;
    const c = side / 2;
    const small = diameter < 16;
    const matrix = small ? BAYER2 : BAYER4;

    const streamers = new IndexedBuffer(side, side);
    const glow = new IndexedBuffer(side, side);
    const disc = new IndexedBuffer(side, side);
    const surface = palette.ramp(cls.surface.ramp).indices;
    const corona = palette.ramp(cls.corona.ramp).indices;
    const surfaceLevels = cls.surface.hi - cls.surface.lo + 1;
    const coronaLevels = cls.corona.hi - cls.corona.lo + 1;

    const spin = TAU * phase(opts.frame, r.period);
    const ca = cos(spin);
    const sa = sin(spin);
    const pulse = phase(opts.frame, r.granulation.pulse);
    // Granules of at least ~2.5 px, so they read as cells and not as noise.
    const granules = Math.min(cls.granules, radius / 2.5);
    const contrast = r.granulation.contrast * (small ? 0.4 : 1);
    const limbPower = 0.8 + 2.4 * cls.limb;
    const granSeed = derive(seed, 'granules');
    const raySeed = derive(seed, 'rays');
    const cell = createCellSample();

    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const px = x + 0.5 - c;
        const py = y + 0.5 - c;
        const d = Math.sqrt(px * px + py * py);
        const threshold = bayerThreshold(matrix, x, y);
        if (d < radius) {
          const dx = px / radius;
          const dy = py / radius;
          const dz = Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
          // Limb darkening as dz^p: with three tones the core, a middle ring and the limb each
          // get a readable band (p ~ 2 puts the boundaries near 0.58 and 0.82 of the radius).
          let v = pow(dz, limbPower);
          if (granules >= 1 && contrast > 0) {
            worley3(granSeed, (dx * ca + dz * sa) * granules, dy * granules, (dz * ca - dx * sa) * granules, cell);
            const beat = sin(TAU * (pulse + (cell.cell & 0xffff) / 65536));
            const lane = cell.f2 - cell.f1 < 0.12 ? 1 : 0;
            v += contrast * (0.08 * beat - 0.14 * lane);
          }
          const q = ditherQuantize(v * surfaceLevels, threshold, 0.5);
          disc.set(x, y, surface[cls.surface.lo + Math.max(0, Math.min(surfaceLevels - 1, q))]);
          continue;
        }
        // Halo: a static glow falling off from the limb tone to an irregular edge.
        const a = atan2(py, px);
        const rays = gradientNoise2(raySeed, cos(a) * 2.5, sin(a) * 2.5) + 0.5 * gradientNoise2(raySeed + 1, cos(a) * 6, sin(a) * 6);
        const edge = radius + (haloRadius - radius) * (1 + r.corona.rays * 0.35 * rays);
        const t = (d - radius) / (edge - radius);
        if (t >= 1) continue;
        const intensity = (1 - t) * (1 - t);
        const level = ditherQuantize(intensity * (coronaLevels + 0.6), threshold, 0.45);
        if (level <= 0) continue;
        glow.set(x, y, corona[cls.corona.lo + Math.min(coronaLevels, level) - 1]);
      }
    }

    // Tiny stars get a cross-shaped glint so they read as stars, not as dots.
    if (diameter <= 8) {
      const arm = Math.max(2, Math.round(haloRadius * 0.9));
      for (let k = 1; k <= arm; k++) {
        const tone = cls.corona.lo + Math.max(0, coronaLevels - 1 - Math.floor(((k - 1) * coronaLevels) / arm));
        for (const [ox, oy] of [[k, 0], [-k, 0], [0, k], [0, -k]] as const) {
          const gx = Math.floor(c) + (ox > 0 ? Math.ceil(radius) - 1 : ox < 0 ? -Math.ceil(radius) : 0) + ox;
          const gy = Math.floor(c) + (oy > 0 ? Math.ceil(radius) - 1 : oy < 0 ? -Math.ceil(radius) : 0) + oy;
          glow.set(gx, gy, corona[tone]);
        }
      }
    }

    // Corona streamers: thin rays from the limb whose pixels repeat the corona tones in order
    // along their length. Palette cycling on them makes the plasma flow outwards; the glow and
    // the disc are not cycled, so the gradient never turns inside out.
    const count = Math.round(r.corona.rays * 10);
    if (diameter > 8 && coronaLevels > 1 && count > 0) {
      const rng = new Rng(derive(seed, 'streamers'));
      const span = haloRadius - radius;
      for (let k = 0; k < count; k++) {
        const angle = ((k + rng.range(-0.3, 0.3)) / count) * TAU;
        const length = span * rng.range(0.6, 1.25);
        const ca2 = cos(angle);
        const sa2 = sin(angle);
        for (let step = 0; step < length; step += 0.5) {
          const gx = Math.floor(c + (radius + step) * ca2);
          const gy = Math.floor(c + (radius + step) * sa2);
          // The tip fades out through the dither.
          if (step / length > 0.55 && bayerThreshold(matrix, gx, gy) < (step / length - 0.55) * 2.2) continue;
          streamers.set(gx, gy, corona[cls.corona.hi - (Math.floor(step / 1.5) % coronaLevels)]);
        }
      }
    }
    const flowing = applyTable(streamers, palette.cycleTable(cls.corona.ramp, -Math.floor(opts.frame / r.corona.cycle), { from: cls.corona.lo, to: cls.corona.hi }));
    const buffer = glow.blit(flowing, 0, 0).blit(disc, 0, 0);

    const id = starIdentity(cls.id, seed);
    return {
      buffer,
      descriptor: {
        class: cls.id,
        label: id.label,
        temperature: id.temperature,
        luminosity: id.luminosity,
        intensity: id.intensity,
        radius,
        haloRadius: Math.round(haloRadius * 10) / 10,
        centre: [c, c],
      },
    };
  },
});
