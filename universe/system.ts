// Star systems: stars, planets, moons, belts and comets of one system, generated from the galaxy
// seed, the sector and the system index alone (random access: no other system is generated).
// The universe decides what exists and where; gen/ decides how it looks, from `recipe` + `look`.

import { pow, TAU } from '../core/dmath';
import { derive } from '../core/hash';
import { Rng } from '../core/rng';
import type { GalacticPoint } from './coords';
import { MAX_SYSTEMS, type Galaxy, type SectorInfo } from './galaxy';
import { catalogCode, catalogNumbers, planetLetter, properName, roman, sectorLetters, starLetter } from './names';
import { apoapsis, orbitPosition, periodTicks, type Orbit } from './orbit';
import { pickStarClass, starIdentity, starType } from './stars';

/** Bumped whenever the same address would produce a different universe. */
export const UNIVERSE_VERSION = 2;

/** Solar radius and Earth radius in AU. */
const SUN_RADIUS_AU = 0.00465;
export const EARTH_RADIUS_AU = 4.26e-5;
/** Planet recipes accept rotation periods up to this many frames. */
const MAX_ROTATION = 4096;

export const ZONES = ['hot', 'habitable', 'cold', 'frost'] as const;
export type Zone = (typeof ZONES)[number];

export const PLANET_ARCHETYPES = ['terran', 'ocean', 'desert', 'ice', 'lava', 'toxic', 'gas', 'cratered', 'dead'] as const;
export type PlanetArchetype = (typeof PLANET_ARCHETYPES)[number];

export const BELT_MATERIALS = ['rocky', 'metallic', 'icy'] as const;
export type BeltMaterial = (typeof BELT_MATERIALS)[number];

export interface Rotation {
  /** Ticks per turn; the generators get it as `period` and the tick as the frame. */
  readonly period: number;
  /** Ticks already turned at tick 0. */
  readonly phase: number;
}

export interface Star {
  readonly index: number;
  readonly name: string;
  readonly seed: number;
  readonly class: string;
  readonly label: string;
  readonly mass: number;
  readonly luminosity: number;
  readonly temperature: number;
  readonly intensity: number;
  /** Radius in AU. */
  readonly radius: number;
  /** Orbit around the barycentre (AU); null for a single star. */
  readonly orbit: Orbit | null;
  readonly rotation: Rotation;
  /** Input for the star generator. */
  readonly recipe: Readonly<Record<string, unknown>>;
}

export interface Moon {
  readonly index: number;
  readonly name: string;
  readonly seed: number;
  /** Seed for the planet generator. */
  readonly look: number;
  readonly archetype: PlanetArchetype;
  /** Earth radii. */
  readonly radius: number;
  /** Orbit around the planet, in planet radii. */
  readonly orbit: Orbit;
  /** Tidally locked: rotation equals the orbit. */
  readonly rotation: Rotation;
  readonly recipe: Readonly<Record<string, unknown>>;
}

export interface Planet {
  readonly index: number;
  /** Catalogue name, e.g. "KX-4471 b". */
  readonly name: string;
  /** Proper name, for planets in the habitable zone. */
  readonly properName: string | null;
  readonly seed: number;
  readonly look: number;
  readonly zone: Zone;
  readonly archetype: PlanetArchetype;
  /** Earth radii. */
  readonly radius: number;
  readonly rings: boolean;
  /** Orbit around the barycentre, AU. */
  readonly orbit: Orbit;
  readonly rotation: Rotation;
  readonly moons: readonly Moon[];
  readonly recipe: Readonly<Record<string, unknown>>;
}

export interface Belt {
  readonly index: number;
  readonly name: string;
  readonly seed: number;
  /** Inner and outer radius, AU. */
  readonly inner: number;
  readonly outer: number;
  readonly material: BeltMaterial;
}

export interface Comet {
  readonly index: number;
  readonly name: string;
  readonly seed: number;
  readonly orbit: Orbit;
}

export interface StarSystem {
  readonly galaxy: number;
  readonly sx: number;
  readonly sy: number;
  readonly index: number;
  readonly seed: number;
  readonly position: GalacticPoint;
  readonly name: string;
  readonly code: string;
  readonly style: number;
  readonly age: number;
  readonly stars: readonly Star[];
  readonly planets: readonly Planet[];
  readonly belts: readonly Belt[];
  readonly comets: readonly Comet[];
  /** Mass (suns) and luminosity (suns) of what the planets orbit: the primary or the close pair. */
  readonly mass: number;
  readonly luminosity: number;
  /** Habitable zone and snow line, AU. */
  readonly habitable: readonly [number, number];
  readonly snowLine: number;
}

/** What a map needs: position and the stars, without planets. */
export interface SystemSummary {
  readonly index: number;
  readonly position: GalacticPoint;
  readonly stars: readonly { readonly class: string; readonly luminosity: number }[];
}

const r3 = (x: number) => Number(x.toPrecision(3));

function pickWeighted<T extends string>(rng: Rng, weights: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of weights) total += w;
  let t = rng.float() * total;
  for (const [v, w] of weights) {
    t -= w;
    if (t < 0) return v;
  }
  return weights[weights.length - 1][0];
}

/** Position of system i inside its sector: a distinct cell of a 4 x 4 grid, with jitter. */
export function systemPosition(sector: SectorInfo, i: number): GalacticPoint {
  const cells = new Rng(derive(sector.seed, 'cells')).shuffle(Array.from({ length: MAX_SYSTEMS }, (_, k) => k));
  const cell = cells[i];
  const rng = new Rng(derive(sector.seed, 'system', i, 'position'));
  const x = ((cell % 4) + rng.range(0.15, 0.85)) / 4;
  const y = (Math.floor(cell / 4) + rng.range(0.15, 0.85)) / 4;
  return { sx: sector.sx, sy: sector.sy, x, y };
}

function checkIndex(sector: SectorInfo, i: number): void {
  if (!Number.isInteger(i) || i < 0 || i >= sector.count) {
    throw new RangeError(`system ${i} does not exist in sector ${sector.sx},${sector.sy} (${sector.count} systems)`);
  }
}

interface StarDraft {
  seed: number;
  class: string;
  identity: ReturnType<typeof starIdentity>;
}

/** Stars of a system, brightest first; the last of three is the distant companion. */
function draftStars(sector: SectorInfo, systemSeed: number): StarDraft[] {
  const roll = new Rng(derive(systemSeed, 'multiplicity')).float();
  const count = roll < 0.02 ? 3 : roll < 0.14 ? 2 : 1;
  const stars: StarDraft[] = [];
  for (let k = 0; k < count; k++) {
    const seed = derive(systemSeed, 'star', k);
    const cls = pickStarClass(sector.age, new Rng(derive(seed, 'class')));
    stars.push({ seed, class: cls, identity: starIdentity(cls, seed) });
  }
  return stars.sort((a, b) => b.identity.luminosity - a.identity.luminosity || a.seed - b.seed);
}

export function systemSummary(sector: SectorInfo, i: number): SystemSummary {
  checkIndex(sector, i);
  const seed = derive(sector.seed, 'system', i);
  const stars = draftStars(sector, seed).map((s) => ({ class: s.class, luminosity: s.identity.luminosity }));
  return { index: i, position: systemPosition(sector, i), stars };
}

/** Names and catalogue codes of every system of a sector; each name avoids the ones before it. */
export function sectorNames(sector: SectorInfo): { name: string; code: string }[] {
  const taken = new Set<string>();
  const letters = sectorLetters(sector.seed);
  const numbers = catalogNumbers(sector.seed, sector.count);
  const out: { name: string; code: string }[] = [];
  for (let j = 0; j < sector.count; j++) {
    const name = properName(sector.style, derive(sector.seed, 'system', j, 'name'), taken);
    taken.add(name);
    out.push({ name, code: catalogCode(letters, numbers[j]) });
  }
  return out;
}

/** Name and code of system i: the names before it decide which ones are taken. */
function systemNames(sector: SectorInfo, i: number): { name: string; code: string } {
  const taken = new Set<string>();
  let name = '';
  for (let j = 0; j <= i; j++) {
    name = properName(sector.style, derive(sector.seed, 'system', j, 'name'), taken);
    taken.add(name);
  }
  const code = catalogCode(sectorLetters(sector.seed), catalogNumbers(sector.seed, sector.count)[i]);
  return { name, code };
}

/** Star radius in AU from luminosity and temperature (Stefan-Boltzmann). */
function starRadius(luminosity: number, temperature: number): number {
  const t = 5772 / temperature;
  return Math.sqrt(luminosity) * t * t * SUN_RADIUS_AU;
}

function rotation(rng: Rng, min: number, max: number): Rotation {
  const period = rng.int(min, max);
  return { period, phase: rng.int(0, period - 1) };
}

function orbit(rng: Rng, a: number, e: number, period: number): Orbit {
  return { a: r3(a), e: Math.round(e * 1000) / 1000, omega: Math.round(rng.range(0, TAU) * 1000) / 1000, period, phase: rng.int(0, period - 1) };
}

function zoneOf(a: number, sqrtL: number): Zone {
  if (a < 0.95 * sqrtL) return 'hot';
  if (a <= 1.67 * sqrtL) return 'habitable';
  if (a <= 2.7 * sqrtL) return 'cold';
  return 'frost';
}

const REMNANTS = new Set(['white-dwarf', 'neutron']);

function archetypeWeights(zone: Zone, primary: string): (readonly [PlanetArchetype, number])[] {
  if (REMNANTS.has(primary)) {
    return [['dead', 3], ['cratered', 3], ['ice', zone === 'frost' ? 2 : 0.5], ['gas', zone === 'frost' ? 1.5 : 0]];
  }
  switch (zone) {
    case 'hot':
      return [['lava', 3], ['desert', 2], ['dead', 2], ['toxic', 1.5]];
    case 'habitable':
      return [['terran', 3], ['ocean', 2], ['desert', 2], ['toxic', 1.5], ['ice', 1], ['dead', 1.5]];
    case 'cold':
      return [['desert', 1.5], ['ice', 3], ['dead', 2], ['cratered', 2]];
    default:
      return [['gas', primary === 'M' ? 2.5 : 6], ['ice', 2], ['cratered', 2], ['dead', 1]];
  }
}

function planetRecipe(archetype: PlanetArchetype, rings: boolean, rot: Rotation): Record<string, unknown> {
  return {
    archetype,
    rings: { chance: rings ? 1 : 0 },
    period: rot.period,
    // Twice the day: surface and clouds together repeat every 2 x period ticks (see rotationFrame).
    clouds: { period: Math.min(MAX_ROTATION, 2 * rot.period) },
  };
}

/** Moon orbital period in ticks for a in planet radii; giants are less dense, so slower. */
function moonPeriod(a: number, gas: boolean): number {
  return Math.max(1, Math.round((gas ? 3 : 1.4) * pow(a, 1.5)));
}

function lockedRotation(o: Orbit): Rotation {
  const period = Math.min(MAX_ROTATION, Math.max(8, o.period));
  return { period, phase: o.phase % period };
}

function moonCount(rng: Rng, archetype: PlanetArchetype): number {
  if (archetype === 'gas') return rng.int(1, 6);
  const big = archetype === 'terran' || archetype === 'ocean' || archetype === 'desert' || archetype === 'ice' || archetype === 'toxic';
  const t = rng.float();
  if (big) return t < 0.35 ? 0 : t < 0.8 ? 1 : 2;
  return t < 0.6 ? 0 : 1;
}

function makeMoons(planetSeed: number, planetName: string, archetype: PlanetArchetype, radius: number, rings: boolean, zone: Zone, count: number): Moon[] {
  const gas = archetype === 'gas';
  const moons: Moon[] = [];
  let a = (rings ? 3.5 : 2.5) * new Rng(derive(planetSeed, 'moon-start')).range(1, 1.4);
  for (let m = 0; m < count; m++) {
    const seed = derive(planetSeed, 'moon', m);
    const rng = new Rng(seed);
    if (m > 0) a *= rng.range(1.4, 2);
    const e = rng.range(0, 0.05);
    const o = orbit(rng, a, e, moonPeriod(a, gas));
    const icy = zone === 'cold' || zone === 'frost';
    const kind = pickWeighted<PlanetArchetype>(rng, [['cratered', 4], ['dead', 3], ['ice', icy ? 3 : 0.3], ['lava', gas ? 0.5 : 0]]);
    const moonRadius = Math.min(radius * 0.5, gas ? rng.range(0.1, 0.45) : rng.range(0.05, 0.3));
    const rot = lockedRotation(o);
    moons.push({
      index: m,
      name: `${planetName} ${roman(m + 1)}`,
      seed,
      look: derive(seed, 'look'),
      archetype: kind,
      radius: r3(moonRadius),
      orbit: o,
      rotation: rot,
      recipe: planetRecipe(kind, false, rot),
    });
  }
  return moons;
}

/** Everything in system i of sector (sx, sy). Throws if the sector has no such system. */
export function generateSystem(galaxy: Galaxy, sx: number, sy: number, i: number): StarSystem {
  const sector = galaxy.sector(sx, sy);
  checkIndex(sector, i);
  const seed = derive(sector.seed, 'system', i);
  const { name, code } = systemNames(sector, i);
  const drafts = draftStars(sector, seed);
  const layout = new Rng(derive(seed, 'layout'));

  // Close pair: both stars orbit the barycentre, planets orbit the pair.
  const pair = drafts.slice(0, Math.min(2, drafts.length));
  const mass = pair.reduce((s, d) => s + d.identity.mass, 0);
  const luminosity = pair.reduce((s, d) => s + d.identity.luminosity, 0);
  const sqrtL = Math.sqrt(luminosity);
  const radii = drafts.map((d) => starRadius(d.identity.luminosity, d.identity.temperature));
  let pairOrbits: (Orbit | null)[] = [null];
  let inner = Math.max(0.02, 4 * radii[0]);
  if (pair.length === 2) {
    const s = Math.max(4 * (radii[0] + radii[1]), layout.range(0.08, 0.3) * Math.max(1, pow(luminosity, 0.25)));
    const e = layout.range(0, 0.2);
    const period = periodTicks(s, mass);
    const phase = layout.int(0, period - 1);
    const omega = Math.round(layout.range(0, TAU) * 1000) / 1000;
    const [m0, m1] = [pair[0].identity.mass, pair[1].identity.mass];
    pairOrbits = [
      { a: r3((s * m1) / mass), e: Math.round(e * 1000) / 1000, omega, period, phase },
      { a: r3((s * m0) / mass), e: Math.round(e * 1000) / 1000, omega: Math.round((omega + TAU / 2) * 1000) / 1000, period, phase },
    ];
    inner = Math.max(inner, 3 * s * (1 + e));
  }

  // Planet and belt slots at growing distances; neighbouring slots never overlap (see tests).
  const primary = drafts[0].class;
  const range = starType(primary).planets;
  const planetCount = layout.int(range[0], range[1]);
  const planets: Planet[] = [];
  const belts: Belt[] = [];
  const snow = 2.7 * sqrtL;
  let a = Math.max(inner, layout.range(0.15, 0.5) * sqrtL);
  let passedSnow = false;
  for (let slot = 0; planets.length < planetCount || (planetCount === 0 && slot === 0); slot++) {
    const firstBeyondSnow = !passedSnow && a > snow;
    if (a > snow) passedSnow = true;
    if (belts.length < 2 && layout.chance(firstBeyondSnow ? 0.35 : planetCount === 0 ? 0.3 : 0.07)) {
      const b = belts.length;
      const beltSeed = derive(seed, 'belt', b);
      const material: BeltMaterial = a > snow ? 'icy' : new Rng(beltSeed).chance(0.3) ? 'metallic' : 'rocky';
      belts.push({ index: b, name: `${code} fascia ${roman(b + 1)}`, seed: beltSeed, inner: r3(0.9 * a), outer: r3(1.1 * a), material });
    } else if (planets.length < planetCount) {
      const n = planets.length;
      const pSeed = derive(seed, 'planet', n);
      const rng = new Rng(pSeed);
      const zone = zoneOf(a, sqrtL);
      const archetype = pickWeighted(rng, archetypeWeights(zone, primary));
      const gas = archetype === 'gas';
      const radius = gas ? rng.range(3.5, 12) : archetype === 'terran' || archetype === 'ocean' ? rng.range(0.7, 1.6) : rng.range(0.4, 1.8);
      const rings = rng.chance(gas ? 0.4 : archetype === 'ice' ? 0.1 : 0.03);
      const e = rng.float() * rng.float() * 0.1;
      const o = orbit(rng, a, e, periodTicks(a, mass));
      // Close-in planets of dim stars are tidally locked.
      const locked = zone === 'hot' && (primary === 'M' || primary === 'K');
      const rot = locked ? lockedRotation(o) : gas ? rotation(rng, 9, 18) : rotation(rng, 8, 60);
      const planetName = `${code} ${planetLetter(n)}`;
      planets.push({
        index: n,
        name: planetName,
        properName: zone === 'habitable' ? properName(sector.style, derive(pSeed, 'name')) : null,
        seed: pSeed,
        look: derive(pSeed, 'look'),
        zone,
        archetype,
        radius: r3(radius),
        rings,
        orbit: o,
        rotation: rot,
        moons: makeMoons(pSeed, planetName, archetype, radius, rings, zone, moonCount(new Rng(derive(pSeed, 'moons')), archetype)),
        recipe: planetRecipe(archetype, rings, rot),
      });
    }
    a *= layout.range(1.5, 2.2);
  }

  // Outermost extent of the planetary system, for the distant companion and the comets.
  let outer = inner;
  for (const p of planets) outer = Math.max(outer, apoapsis(p.orbit));
  for (const b of belts) outer = Math.max(outer, b.outer);

  const stars: Star[] = drafts.map((d, k) => {
    let o = pairOrbits[k] ?? null;
    if (k === 2) {
      const rng = new Rng(derive(d.seed, 'orbit'));
      const a3 = Math.max(3 * outer, 20 * sqrtL) * rng.range(1, 2);
      o = orbit(rng, a3, rng.range(0, 0.3), periodTicks(a3, mass + d.identity.mass));
    }
    const rot = rotation(new Rng(derive(d.seed, 'rotation')), 300, 900);
    return {
      index: k,
      name: drafts.length > 1 ? `${code} ${starLetter(k)}` : code,
      seed: d.seed,
      class: d.class,
      label: d.identity.label,
      mass: d.identity.mass,
      luminosity: d.identity.luminosity,
      temperature: d.identity.temperature,
      intensity: d.identity.intensity,
      radius: r3(radii[k]),
      orbit: o,
      rotation: rot,
      recipe: { class: d.class, period: rot.period },
    };
  });

  const cometRoll = new Rng(derive(seed, 'comets'));
  const t = cometRoll.float();
  const cometCount = t < 0.4 ? 0 : t < 0.7 ? 1 : t < 0.9 ? 2 : 3;
  const comets: Comet[] = [];
  for (let c = 0; c < cometCount; c++) {
    const cSeed = derive(seed, 'comet', c);
    const rng = new Rng(cSeed);
    const q = Math.max(inner, rng.range(0.3, 1.5) * sqrtL);
    const e = rng.range(0.6, 0.95);
    const ca = q / (1 - e);
    comets.push({ index: c, name: `P/${code}-${c + 1}`, seed: cSeed, orbit: orbit(rng, ca, e, periodTicks(ca, mass)) });
  }

  return {
    galaxy: galaxy.seed,
    sx,
    sy,
    index: i,
    seed,
    position: systemPosition(sector, i),
    name,
    code,
    style: sector.style,
    age: sector.age,
    stars,
    planets,
    belts,
    comets,
    mass: r3(mass),
    luminosity: r3(luminosity),
    habitable: [r3(0.95 * sqrtL), r3(1.67 * sqrtL)],
    snowLine: r3(snow),
  };
}

/** Position of a star, planet or moon at `tick`, in AU from the barycentre. */
export function starPosition(star: Star, tick: number): { x: number; y: number } {
  return star.orbit === null ? { x: 0, y: 0 } : orbitPosition(star.orbit, tick);
}

export function planetPosition(planet: Planet, tick: number): { x: number; y: number } {
  return orbitPosition(planet.orbit, tick);
}

export function moonPosition(planet: Planet, moon: Moon, tick: number): { x: number; y: number } {
  const p = orbitPosition(planet.orbit, tick);
  const m = orbitPosition(moon.orbit, tick);
  const k = planet.radius * EARTH_RADIUS_AU;
  return { x: p.x + m.x * k, y: p.y + m.y * k };
}

/**
 * Frame of a rotating body at `tick`: what its generator gets as `frame`. Surface and clouds
 * (twice the day) repeat every 2 x period, so frames repeat too and can be cached.
 */
export function rotationFrame(rot: Rotation, tick: number): number {
  const loop = 2 * rot.period;
  return (((tick + rot.phase) % loop) + loop) % loop;
}
