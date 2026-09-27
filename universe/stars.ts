// Physical data of the stellar classes, shared by the universe (what exists) and gen/star (how
// it looks): classes, masses, luminosities, temperatures, catalogue labels.

import { LN10, log, pow } from '../core/dmath';
import { derive } from '../core/hash';
import { Rng } from '../core/rng';

export interface StarType {
  readonly id: string;
  /** Spectral letter used in labels. */
  readonly letter: string;
  /** Luminosity class: V main sequence, III giant, D white dwarf, N neutron star. */
  readonly luminosityClass: string;
  readonly mass: readonly [number, number];
  readonly luminosity: readonly [number, number];
  readonly temperature: readonly [number, number];
  /** Relative frequency in a young and in an old stellar population. */
  readonly young: number;
  readonly old: number;
  /** Planets around a star of this class, inclusive range. */
  readonly planets: readonly [number, number];
}

export const STAR_TYPES: readonly StarType[] = [
  { id: 'O', letter: 'O', luminosityClass: 'V', mass: [16, 60], luminosity: [30000, 500000], temperature: [30000, 50000], young: 0.6, old: 0, planets: [0, 3] },
  { id: 'B', letter: 'B', luminosityClass: 'V', mass: [2.1, 16], luminosity: [25, 30000], temperature: [10000, 30000], young: 2.4, old: 0.1, planets: [0, 4] },
  { id: 'A', letter: 'A', luminosityClass: 'V', mass: [1.4, 2.1], luminosity: [5, 25], temperature: [7500, 10000], young: 4.4, old: 1.4, planets: [2, 6] },
  { id: 'F', letter: 'F', luminosityClass: 'V', mass: [1.04, 1.4], luminosity: [1.5, 5], temperature: [6000, 7500], young: 8, old: 5, planets: [3, 8] },
  { id: 'G', letter: 'G', luminosityClass: 'V', mass: [0.8, 1.04], luminosity: [0.6, 1.5], temperature: [5200, 6000], young: 10, old: 8.5, planets: [3, 9] },
  { id: 'K', letter: 'K', luminosityClass: 'V', mass: [0.45, 0.8], luminosity: [0.08, 0.6], temperature: [3700, 5200], young: 15, old: 19, planets: [2, 6] },
  { id: 'M', letter: 'M', luminosityClass: 'V', mass: [0.08, 0.45], luminosity: [0.001, 0.08], temperature: [2400, 3700], young: 45, old: 53, planets: [1, 4] },
  { id: 'white-dwarf', letter: 'D', luminosityClass: 'D', mass: [0.5, 1.3], luminosity: [0.0001, 0.1], temperature: [8000, 40000], young: 1, old: 6, planets: [0, 2] },
  { id: 'red-giant', letter: 'M', luminosityClass: 'III', mass: [0.8, 3], luminosity: [100, 3000], temperature: [3000, 4500], young: 1.5, old: 4, planets: [1, 4] },
  { id: 'neutron', letter: 'N', luminosityClass: 'N', mass: [1.2, 2.2], luminosity: [0.00001, 0.001], temperature: [500000, 1000000], young: 0.6, old: 0.4, planets: [0, 2] },
];

export const STAR_CLASS_IDS = STAR_TYPES.map((t) => t.id);

export function starType(id: string): StarType {
  const t = STAR_TYPES.find((s) => s.id === id);
  if (t === undefined) throw new RangeError(`unknown star class ${id}`);
  return t;
}

/** Class of a star in a population of the given age (0 young .. 1 old). */
export function pickStarClass(age: number, rng: Rng): string {
  let total = 0;
  for (const t of STAR_TYPES) total += t.young + (t.old - t.young) * age;
  let x = rng.float() * total;
  for (const t of STAR_TYPES) {
    x -= t.young + (t.old - t.young) * age;
    if (x < 0) return t.id;
  }
  return STAR_TYPES[STAR_TYPES.length - 1].id;
}

export interface StarIdentity {
  /** Catalogue label, e.g. "G2 V", "D3", "NS". */
  readonly label: string;
  readonly subclass: number;
  readonly temperature: number;
  readonly luminosity: number;
  readonly mass: number;
  /** Brightness 0.05..1 on a log scale of luminosity, for lighting planets. */
  readonly intensity: number;
}

/** Subclass and physical values of a star of class `id`, from its seed. */
export function starIdentity(id: string, seed: number): StarIdentity {
  const cls = starType(id);
  const rng = new Rng(derive(seed, 'subclass'));
  const sub = rng.int(0, 9);
  const t = 1 - sub / 9; // subclass 0 is the hottest
  const temperature = Math.round(cls.temperature[0] + (cls.temperature[1] - cls.temperature[0]) * t);
  const [l0, l1] = cls.luminosity;
  const luminosity = Number((l0 * pow(l1 / l0, t)).toPrecision(3));
  const [m0, m1] = cls.mass;
  const mass = Number((m0 * pow(m1 / m0, t)).toPrecision(3));
  const label = cls.id === 'neutron' ? 'NS' : cls.id === 'white-dwarf' ? `D${sub}` : `${cls.letter}${sub} ${cls.luminosityClass}`;
  const intensity = Math.round(Math.min(1, Math.max(0.05, (log(luminosity) / LN10 + 5) / 10.7)) * 1000) / 1000;
  return { label, subclass: sub, temperature, luminosity, mass, intensity };
}
