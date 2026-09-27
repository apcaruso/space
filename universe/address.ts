// Addresses: galaxy / sector / system / body, stable across runs and serialisable to a short
// string for links, e.g. "51u7i0.-c.14.3.p2m1": galaxy, sector and system in base 36, the body
// as a letter and decimal indices, levels separated by dots.

import { Galaxy } from './galaxy';
import { generateSystem, type Belt, type Comet, type Moon, type Planet, type Star, type StarSystem } from './system';

export type BodyRef =
  | { readonly kind: 'star'; readonly index: number }
  | { readonly kind: 'planet'; readonly index: number; readonly moon?: number }
  | { readonly kind: 'belt'; readonly index: number }
  | { readonly kind: 'comet'; readonly index: number };

export interface Address {
  /** Galaxy seed, uint32. */
  readonly galaxy: number;
  readonly sector?: { readonly sx: number; readonly sy: number };
  /** System index inside the sector; requires `sector`. */
  readonly system?: number;
  /** Body inside the system; requires `system`. */
  readonly body?: BodyRef;
}

export class AddressError extends Error {}

const INT32 = 2147483647;
const BODY_PREFIX = { star: 's', planet: 'p', belt: 'a', comet: 'c' } as const;

function checkInt(n: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(n) || n < min || n > max) throw new AddressError(`${what} non valido: ${n}`);
}

function validate(a: Address): void {
  checkInt(a.galaxy, 0, 0xffffffff, 'seed della galassia');
  if (a.sector !== undefined) {
    checkInt(a.sector.sx, -INT32, INT32, 'settore x');
    checkInt(a.sector.sy, -INT32, INT32, 'settore y');
  }
  if (a.system !== undefined) {
    if (a.sector === undefined) throw new AddressError('un sistema richiede il settore');
    checkInt(a.system, 0, 1295, 'indice del sistema');
  }
  if (a.body !== undefined) {
    if (a.system === undefined) throw new AddressError('un corpo richiede il sistema');
    checkInt(a.body.index, 0, 999, 'indice del corpo');
    if (a.body.kind === 'planet' && a.body.moon !== undefined) checkInt(a.body.moon, 0, 999, 'indice della luna');
  }
}

export function formatAddress(a: Address): string {
  validate(a);
  const parts = [a.galaxy.toString(36)];
  if (a.sector !== undefined) parts.push(a.sector.sx.toString(36), a.sector.sy.toString(36));
  if (a.system !== undefined) parts.push(a.system.toString(36));
  if (a.body !== undefined) {
    const b = a.body;
    // Body indices in decimal: "m" is a base-36 digit, so "p2m1" must not read as one number.
    let s = BODY_PREFIX[b.kind] + String(b.index);
    if (b.kind === 'planet' && b.moon !== undefined) s += `m${b.moon}`;
    parts.push(s);
  }
  return parts.join('.');
}

/** Base-36 integer with an optional minus sign, in canonical form (no "+", no leading zeros). */
function parseBase36(s: string, what: string): number {
  if (!/^-?(0|[1-9a-z][0-9a-z]*)$/.test(s) || s === '-0') throw new AddressError(`${what} non valido: "${s}"`);
  const n = parseInt(s, 36);
  if (!Number.isSafeInteger(n)) throw new AddressError(`${what} fuori scala: "${s}"`);
  return n;
}

function parseBody(s: string): BodyRef {
  const m = /^([spac])(0|[1-9]\d{0,2})(?:m(0|[1-9]\d{0,2}))?$/.exec(s);
  if (m === null || (m[3] !== undefined && m[1] !== 'p')) {
    throw new AddressError(`corpo non valido: "${s}" (attesi s<n> stella, p<n> pianeta, p<n>m<n> luna, a<n> fascia, c<n> cometa)`);
  }
  const index = Number(m[2]);
  switch (m[1]) {
    case 's':
      return { kind: 'star', index };
    case 'a':
      return { kind: 'belt', index };
    case 'c':
      return { kind: 'comet', index };
    default:
      return m[3] === undefined ? { kind: 'planet', index } : { kind: 'planet', index, moon: Number(m[3]) };
  }
}

/** Inverse of formatAddress; throws AddressError with a readable (Italian) message. */
export function parseAddress(text: string): Address {
  const s = text.trim().toLowerCase();
  if (s === '') throw new AddressError('indirizzo vuoto');
  if (!/^[0-9a-z.-]+$/.test(s)) throw new AddressError(`indirizzo non valido: "${text}" (ammessi solo 0-9, a-z, punto e meno)`);
  const parts = s.split('.');
  if (parts.length === 2) throw new AddressError(`indirizzo incompleto: "${text}" (il settore vuole due coordinate)`);
  if (parts.length > 5) throw new AddressError(`indirizzo troppo lungo: "${text}"`);
  const address: { -readonly [K in keyof Address]: Address[K] } = { galaxy: parseBase36(parts[0], 'seed della galassia') };
  if (parts.length >= 3) address.sector = { sx: parseBase36(parts[1], 'settore x'), sy: parseBase36(parts[2], 'settore y') };
  if (parts.length >= 4) address.system = parseBase36(parts[3], 'indice del sistema');
  if (parts.length === 5) address.body = parseBody(parts[4]);
  validate(address);
  return address;
}

export type Resolved =
  | { readonly kind: 'galaxy'; readonly galaxy: Galaxy }
  | { readonly kind: 'sector'; readonly galaxy: Galaxy; readonly sx: number; readonly sy: number }
  | { readonly kind: 'system'; readonly galaxy: Galaxy; readonly system: StarSystem }
  | { readonly kind: 'star'; readonly galaxy: Galaxy; readonly system: StarSystem; readonly star: Star }
  | { readonly kind: 'planet'; readonly galaxy: Galaxy; readonly system: StarSystem; readonly planet: Planet }
  | { readonly kind: 'moon'; readonly galaxy: Galaxy; readonly system: StarSystem; readonly planet: Planet; readonly moon: Moon }
  | { readonly kind: 'belt'; readonly galaxy: Galaxy; readonly system: StarSystem; readonly belt: Belt }
  | { readonly kind: 'comet'; readonly galaxy: Galaxy; readonly system: StarSystem; readonly comet: Comet };

/** The object an address points to; throws AddressError if it does not exist. */
export function resolve(a: Address, galaxy: Galaxy = new Galaxy(a.galaxy)): Resolved {
  validate(a);
  if (galaxy.seed !== a.galaxy) throw new AddressError(`la galassia ${galaxy.seed} non è quella dell'indirizzo (${a.galaxy})`);
  if (a.sector === undefined) return { kind: 'galaxy', galaxy };
  const { sx, sy } = a.sector;
  if (a.system === undefined) return { kind: 'sector', galaxy, sx, sy };
  const count = galaxy.sector(sx, sy).count;
  if (a.system >= count) {
    throw new AddressError(`il settore ${sx},${sy} ha ${count} sistem${count === 1 ? 'a' : 'i'}: il sistema ${a.system} non esiste`);
  }
  const system = generateSystem(galaxy, sx, sy, a.system);
  const b = a.body;
  if (b === undefined) return { kind: 'system', galaxy, system };
  const missing = (what: string, n: number) =>
    new AddressError(`${system.name} (${system.code}) ha ${n} ${what}: l'indice ${b.index} non esiste`);
  switch (b.kind) {
    case 'star': {
      const star = system.stars[b.index] as Star | undefined;
      if (star === undefined) throw missing(system.stars.length === 1 ? 'stella' : 'stelle', system.stars.length);
      return { kind: 'star', galaxy, system, star };
    }
    case 'belt': {
      const belt = system.belts[b.index] as Belt | undefined;
      if (belt === undefined) throw missing('fasce di asteroidi', system.belts.length);
      return { kind: 'belt', galaxy, system, belt };
    }
    case 'comet': {
      const comet = system.comets[b.index] as Comet | undefined;
      if (comet === undefined) throw missing('comete', system.comets.length);
      return { kind: 'comet', galaxy, system, comet };
    }
    default: {
      const planet = system.planets[b.index] as Planet | undefined;
      if (planet === undefined) throw missing('pianeti', system.planets.length);
      if (b.moon === undefined) return { kind: 'planet', galaxy, system, planet };
      const moon = planet.moons[b.moon] as Moon | undefined;
      if (moon === undefined) throw new AddressError(`${planet.name} ha ${planet.moons.length} lune: la luna ${b.moon} non esiste`);
      return { kind: 'moon', galaxy, system, planet, moon };
    }
  }
}
