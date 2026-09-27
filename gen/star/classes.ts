// Spectral classes: what each kind of star looks like. Physical data (mass, luminosity,
// temperature, labels) live in universe/stars.ts.

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
  /** Relative frequency when the recipe says "auto". */
  readonly weight: number;
}

export const STAR_CLASSES: readonly StarClass[] = [
  {
    id: 'O', scale: 1.5,
    surface: { ramp: 'energy', lo: 2, hi: 3 }, corona: { ramp: 'ocean', lo: 2, hi: 4 },
    halo: 2.6, limb: 0.35, granules: 5, weight: 0.3,
  },
  {
    id: 'B', scale: 1.3,
    surface: { ramp: 'ice', lo: 2, hi: 3 }, corona: { ramp: 'gas-cold', lo: 1, hi: 3 },
    halo: 2.3, limb: 0.4, granules: 5, weight: 0.6,
  },
  {
    id: 'A', scale: 1.15,
    surface: { ramp: 'cloud', lo: 2, hi: 3 }, corona: { ramp: 'metal-light', lo: 0, hi: 2 },
    halo: 2.0, limb: 0.45, granules: 5, weight: 1,
  },
  {
    id: 'F', scale: 1.05,
    surface: { ramp: 'sand', lo: 2, hi: 3 }, corona: { ramp: 'sand', lo: 0, hi: 2 },
    halo: 1.85, limb: 0.5, granules: 6, weight: 1.3,
  },
  {
    id: 'G', scale: 1,
    surface: { ramp: 'ui-warm', lo: 2, hi: 3 }, corona: { ramp: 'ui-warm', lo: 0, hi: 2 },
    halo: 1.75, limb: 0.55, granules: 6, weight: 1.6,
  },
  {
    id: 'K', scale: 0.88,
    surface: { ramp: 'magma', lo: 3, hi: 4 }, corona: { ramp: 'magma', lo: 1, hi: 3 },
    halo: 1.65, limb: 0.6, granules: 6, weight: 1.8,
  },
  {
    id: 'M', scale: 0.72,
    surface: { ramp: 'magma', lo: 2, hi: 3 }, corona: { ramp: 'magma', lo: 0, hi: 2 },
    halo: 1.55, limb: 0.65, granules: 5, weight: 2.5,
  },
  {
    id: 'white-dwarf', scale: 0.4,
    surface: { ramp: 'cloud', lo: 3, hi: 3 }, corona: { ramp: 'energy', lo: 0, hi: 2 },
    halo: 3.2, limb: 0.2, granules: 3, weight: 0.5,
  },
  {
    id: 'red-giant', scale: 2.2,
    surface: { ramp: 'magma', lo: 1, hi: 3 }, corona: { ramp: 'magma', lo: 0, hi: 1 },
    halo: 1.35, limb: 0.75, granules: 2.5, weight: 0.6,
  },
  {
    id: 'neutron', scale: 0.22,
    surface: { ramp: 'energy', lo: 3, hi: 3 }, corona: { ramp: 'crystal-magenta', lo: 1, hi: 3 },
    halo: 5, limb: 0, granules: 1, weight: 0.15,
  },
];

export const CLASS_IDS = STAR_CLASSES.map((c) => c.id);

export function starClass(id: string): StarClass {
  const c = STAR_CLASSES.find((s) => s.id === id);
  if (c === undefined) throw new RangeError(`unknown star class ${id}`);
  return c;
}
