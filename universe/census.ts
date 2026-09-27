// Census: statistics over systems drawn uniformly from a galaxy, and the ranges they are
// expected to fall in (docs/plans/step-06.md). Used by `forge census` and by the tests.

import { derive } from '../core/hash';
import { Rng } from '../core/rng';
import { MAX_SYSTEMS, type Galaxy } from './galaxy';
import { STAR_CLASS_IDS } from './stars';
import { generateSystem, PLANET_ARCHETYPES, ZONES, type StarSystem } from './system';

export interface SystemRef {
  readonly sx: number;
  readonly sy: number;
  readonly index: number;
}

/**
 * `count` systems, each equally likely among all systems of the galaxy: a random sector is kept
 * with probability count/16, then one of its systems is chosen.
 */
export function sampleSystems(galaxy: Galaxy, count: number, seed = 0): SystemRef[] {
  const rng = new Rng(derive(galaxy.seed, 'sample', seed));
  const extent = Math.ceil(galaxy.shape.radius * 1.25);
  const out: SystemRef[] = [];
  while (out.length < count) {
    const sx = rng.int(-extent, extent);
    const sy = rng.int(-extent, extent);
    const info = galaxy.sector(sx, sy);
    if (info.count === 0 || rng.int(1, MAX_SYSTEMS) > info.count) continue;
    out.push({ sx, sy, index: rng.int(0, info.count - 1) });
  }
  return out;
}

export interface Census {
  readonly systems: number;
  /** Share of systems by primary star class. */
  readonly classes: Readonly<Record<string, number>>;
  /** Share of single, binary and triple systems. */
  readonly multiplicity: readonly [number, number, number];
  readonly planetsPerSystem: number;
  /** Share of planets by archetype and by zone. */
  readonly archetypes: Readonly<Record<string, number>>;
  readonly zones: Readonly<Record<string, number>>;
  readonly moonsPerPlanet: number;
  readonly moonsPerGiant: number;
  readonly ringed: number;
  readonly beltsPerSystem: number;
  readonly cometsPerSystem: number;
  /** Share of systems with at least one terran or ocean planet. */
  readonly habitableWorlds: number;
}

export function takeCensus(systems: readonly StarSystem[]): Census {
  const classes: Record<string, number> = Object.fromEntries(STAR_CLASS_IDS.map((c) => [c, 0]));
  const archetypes: Record<string, number> = Object.fromEntries(PLANET_ARCHETYPES.map((a) => [a, 0]));
  const zones: Record<string, number> = Object.fromEntries(ZONES.map((z) => [z, 0]));
  const multiplicity: [number, number, number] = [0, 0, 0];
  let planets = 0;
  let moons = 0;
  let giants = 0;
  let giantMoons = 0;
  let ringed = 0;
  let belts = 0;
  let comets = 0;
  let habitable = 0;
  for (const s of systems) {
    classes[s.stars[0].class]++;
    multiplicity[s.stars.length - 1]++;
    belts += s.belts.length;
    comets += s.comets.length;
    let lush = false;
    for (const p of s.planets) {
      planets++;
      archetypes[p.archetype]++;
      zones[p.zone]++;
      moons += p.moons.length;
      if (p.rings) ringed++;
      if (p.archetype === 'gas') {
        giants++;
        giantMoons += p.moons.length;
      }
      if (p.archetype === 'terran' || p.archetype === 'ocean') lush = true;
    }
    if (lush) habitable++;
  }
  const n = systems.length;
  const share = (rec: Record<string, number>, total: number) =>
    Object.fromEntries(Object.keys(rec).map((k) => [k, total === 0 ? 0 : rec[k] / total]));
  return {
    systems: n,
    classes: share(classes, n),
    multiplicity: [multiplicity[0] / n, multiplicity[1] / n, multiplicity[2] / n],
    planetsPerSystem: planets / n,
    archetypes: share(archetypes, planets),
    zones: share(zones, planets),
    moonsPerPlanet: moons / Math.max(1, planets),
    moonsPerGiant: giantMoons / Math.max(1, giants),
    ringed: ringed / Math.max(1, planets),
    beltsPerSystem: belts / n,
    cometsPerSystem: comets / n,
    habitableWorlds: habitable / n,
  };
}

export function censusOf(galaxy: Galaxy, count: number, seed = 0): Census {
  return takeCensus(sampleSystems(galaxy, count, seed).map((r) => generateSystem(galaxy, r.sx, r.sy, r.index)));
}

export interface Expectation {
  /** Human-readable name, in Italian (printed by the CLI). */
  readonly label: string;
  readonly value: (c: Census) => number;
  /** A share of a population (printed as a percentage) rather than a mean count. */
  readonly share: boolean;
  readonly min: number;
  readonly max: number;
}

const cls = (...ids: string[]) => (c: Census) => ids.reduce((s, id) => s + c.classes[id], 0);
const arch = (...ids: string[]) => (c: Census) => ids.reduce((s, id) => s + c.archetypes[id], 0);

/** Expected ranges, from the plan: many red dwarfs, few massive stars, rare multiples. */
export const EXPECTED: readonly Expectation[] = [
  { label: 'stelle M', value: cls('M'), share: true, min: 0.45, max: 0.55 },
  { label: 'stelle K', value: cls('K'), share: true, min: 0.15, max: 0.2 },
  { label: 'stelle G', value: cls('G'), share: true, min: 0.08, max: 0.12 },
  { label: 'stelle F', value: cls('F'), share: true, min: 0.05, max: 0.09 },
  { label: 'stelle A', value: cls('A'), share: true, min: 0.02, max: 0.05 },
  { label: 'stelle B e O', value: cls('B', 'O'), share: true, min: 0.003, max: 0.03 },
  { label: 'nane bianche e stelle di neutroni', value: cls('white-dwarf', 'neutron'), share: true, min: 0.02, max: 0.08 },
  { label: 'giganti rosse', value: cls('red-giant'), share: true, min: 0.01, max: 0.05 },
  { label: 'sistemi binari', value: (c) => c.multiplicity[1], share: true, min: 0.1, max: 0.14 },
  { label: 'sistemi tripli', value: (c) => c.multiplicity[2], share: true, min: 0.01, max: 0.03 },
  { label: 'pianeti per sistema', value: (c) => c.planetsPerSystem, share: false, min: 2.5, max: 4.5 },
  { label: 'giganti gassosi', value: arch('gas'), share: true, min: 0.1, max: 0.3 },
  { label: 'terrestri e oceanici', value: arch('terran', 'ocean'), share: true, min: 0.03, max: 0.12 },
  { label: 'pianeti di lava', value: arch('lava'), share: true, min: 0.05, max: 0.2 },
  { label: 'lune per pianeta', value: (c) => c.moonsPerPlanet, share: false, min: 0.6, max: 1.6 },
  { label: 'lune per gigante gassoso', value: (c) => c.moonsPerGiant, share: false, min: 3, max: 4 },
  { label: 'pianeti con anelli', value: (c) => c.ringed, share: true, min: 0.04, max: 0.15 },
  { label: 'fasce per sistema', value: (c) => c.beltsPerSystem, share: false, min: 0.2, max: 0.8 },
  { label: 'comete per sistema', value: (c) => c.cometsPerSystem, share: false, min: 0.8, max: 1.2 },
  { label: 'sistemi con un mondo terrestre o oceanico', value: (c) => c.habitableWorlds, share: true, min: 0.05, max: 0.3 },
];
