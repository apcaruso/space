// Spectral classes: what each kind of star looks like and what the panel says about it.

/**
 * Tones: the surface uses the brightest tones of its ramp (core to limb) and the innermost
 * corona tone matches the limb, so light falls off continuously from core to space.
 */
export interface ToneRange {
  readonly ramp: string;
  /** First and last tone used, darkest to brightest. */
  readonly lo: number;
  readonly hi: number;
}

export interface StarClass {
  readonly id: string;
  /** Spectral letter or short tag shown in labels. */
  readonly letter: string;
  /** Luminosity class (V main sequence, III giant, D white dwarf, N neutron star). */
  readonly luminosityClass: string;
  /** Disc diameter relative to a Sun-like star at the same zoom step. */
  readonly scale: number;
  readonly surface: ToneRange;
  readonly corona: ToneRange;
  /** Halo radius in disc radii. */
  readonly halo: number;
  /** Limb darkening strength, 0..1. */
  readonly limb: number;
  /** Granule cells per disc radius (fewer = bigger convection cells). */
  readonly granules: number;
  /** Surface temperature range, K. */
  readonly temperature: readonly [number, number];
  /** Luminosity range, in suns. */
  readonly luminosity: readonly [number, number];
  /** Relative frequency when the recipe says "auto". */
  readonly weight: number;
}

export const STAR_CLASSES: readonly StarClass[] = [
  {
    id: 'O', letter: 'O', luminosityClass: 'V', scale: 1.5,
    surface: { ramp: 'energy', lo: 2, hi: 3 }, corona: { ramp: 'ocean', lo: 2, hi: 4 },
    halo: 2.6, limb: 0.35, granules: 5, temperature: [30000, 50000], luminosity: [30000, 500000], weight: 0.3,
  },
  {
    id: 'B', letter: 'B', luminosityClass: 'V', scale: 1.3,
    surface: { ramp: 'ice', lo: 2, hi: 3 }, corona: { ramp: 'gas-cold', lo: 1, hi: 3 },
    halo: 2.3, limb: 0.4, granules: 5, temperature: [10000, 30000], luminosity: [25, 30000], weight: 0.6,
  },
  {
    id: 'A', letter: 'A', luminosityClass: 'V', scale: 1.15,
    surface: { ramp: 'cloud', lo: 2, hi: 3 }, corona: { ramp: 'metal-light', lo: 0, hi: 2 },
    halo: 2.0, limb: 0.45, granules: 5, temperature: [7500, 10000], luminosity: [5, 25], weight: 1,
  },
  {
    id: 'F', letter: 'F', luminosityClass: 'V', scale: 1.05,
    surface: { ramp: 'sand', lo: 2, hi: 3 }, corona: { ramp: 'sand', lo: 0, hi: 2 },
    halo: 1.85, limb: 0.5, granules: 6, temperature: [6000, 7500], luminosity: [1.5, 5], weight: 1.3,
  },
  {
    id: 'G', letter: 'G', luminosityClass: 'V', scale: 1,
    surface: { ramp: 'ui-warm', lo: 2, hi: 3 }, corona: { ramp: 'ui-warm', lo: 0, hi: 2 },
    halo: 1.75, limb: 0.55, granules: 6, temperature: [5200, 6000], luminosity: [0.6, 1.5], weight: 1.6,
  },
  {
    id: 'K', letter: 'K', luminosityClass: 'V', scale: 0.88,
    surface: { ramp: 'magma', lo: 3, hi: 4 }, corona: { ramp: 'magma', lo: 1, hi: 3 },
    halo: 1.65, limb: 0.6, granules: 6, temperature: [3700, 5200], luminosity: [0.08, 0.6], weight: 1.8,
  },
  {
    id: 'M', letter: 'M', luminosityClass: 'V', scale: 0.72,
    surface: { ramp: 'magma', lo: 2, hi: 3 }, corona: { ramp: 'magma', lo: 0, hi: 2 },
    halo: 1.55, limb: 0.65, granules: 5, temperature: [2400, 3700], luminosity: [0.001, 0.08], weight: 2.5,
  },
  {
    id: 'white-dwarf', letter: 'D', luminosityClass: 'D', scale: 0.4,
    surface: { ramp: 'cloud', lo: 3, hi: 3 }, corona: { ramp: 'energy', lo: 0, hi: 2 },
    halo: 3.2, limb: 0.2, granules: 3, temperature: [8000, 40000], luminosity: [0.0001, 0.1], weight: 0.5,
  },
  {
    id: 'red-giant', letter: 'M', luminosityClass: 'III', scale: 2.2,
    surface: { ramp: 'magma', lo: 1, hi: 3 }, corona: { ramp: 'magma', lo: 0, hi: 1 },
    halo: 1.35, limb: 0.75, granules: 2.5, temperature: [3000, 4500], luminosity: [100, 3000], weight: 0.6,
  },
  {
    id: 'neutron', letter: 'N', luminosityClass: 'N', scale: 0.22,
    surface: { ramp: 'energy', lo: 3, hi: 3 }, corona: { ramp: 'crystal-magenta', lo: 1, hi: 3 },
    halo: 5, limb: 0, granules: 1, temperature: [500000, 1000000], luminosity: [0.00001, 0.001], weight: 0.15,
  },
];

export const CLASS_IDS = STAR_CLASSES.map((c) => c.id);

export function starClass(id: string): StarClass {
  const c = STAR_CLASSES.find((s) => s.id === id);
  if (c === undefined) throw new RangeError(`unknown star class ${id}`);
  return c;
}
