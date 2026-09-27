// Words for the interface: names, classifications and data of every kind of object, in Italian,
// and the search over system names and catalogue codes.

import { formatAddress, type Address } from '../universe/address';
import type { Galaxy } from '../universe/galaxy';
import { foldName } from '../universe/names';
import { TICKS_PER_YEAR } from '../universe/orbit';
import { sectorNames, type StarSystem } from '../universe/system';

export const STAR_NAMES: Readonly<Record<string, string>> = {
  O: 'stella blu',
  B: 'stella azzurra',
  A: 'stella bianca',
  F: 'stella bianco-gialla',
  G: 'nana gialla',
  K: 'nana arancione',
  M: 'nana rossa',
  'white-dwarf': 'nana bianca',
  'red-giant': 'gigante rossa',
  neutron: 'stella di neutroni',
};

export const ARCHETYPE_NAMES: Readonly<Record<string, string>> = {
  terran: 'mondo terrestre',
  ocean: 'mondo oceanico',
  desert: 'mondo desertico',
  ice: 'mondo ghiacciato',
  lava: 'mondo di lava',
  toxic: 'mondo tossico',
  gas: 'gigante gassoso',
  cratered: 'mondo craterizzato',
  dead: 'mondo morto',
};

export const ZONE_NAMES: Readonly<Record<string, string>> = {
  hot: 'zona calda',
  habitable: 'zona abitabile',
  cold: 'zona fredda',
  frost: 'oltre la neve',
};

export const BELT_NAMES: Readonly<Record<string, string>> = {
  rocky: 'fascia rocciosa',
  metallic: 'fascia metallica',
  icy: 'fascia ghiacciata',
};

export const MATERIAL_NAMES: Readonly<Record<string, string>> = {
  liquid: 'mare',
  shallows: 'bassi fondali',
  lowland: 'pianure',
  highland: 'altopiani',
  cap: 'calotte',
  crack: 'crepe',
  'band-dark': 'bande scure',
  'band-mid': 'bande',
  'band-light': 'bande chiare',
  storm: 'tempeste',
  'crater-floor': 'fondi dei crateri',
  'crater-rim': 'bordi dei crateri',
};

/** Italian decimal: comma, a few significant digits. */
export function num(x: number, digits = 2): string {
  const abs = Math.abs(x);
  const d = abs >= 100 ? 0 : abs >= 10 ? Math.min(digits, 1) : digits;
  return x.toFixed(d).replace('.', ',');
}

/** Simulated date of a tick: year, day, hour. */
export function dateOf(tick: number): string {
  const year = Math.floor(tick / TICKS_PER_YEAR);
  const rest = tick - year * TICKS_PER_YEAR;
  const day = Math.floor(rest / 24);
  const hour = rest - day * 24;
  return `anno ${year + 1}, giorno ${day + 1}, ${String(hour).padStart(2, '0')}:00`;
}

/** A duration in ticks, readable: hours, days or years. */
export function duration(ticks: number): string {
  if (ticks < 48) return `${ticks} ore`;
  if (ticks < TICKS_PER_YEAR * 2) return `${num(ticks / 24, 1)} giorni`;
  return `${num(ticks / TICKS_PER_YEAR, 1)} anni`;
}

export interface Card {
  readonly title: string;
  readonly subtitle: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly address: string;
}

/** The information card of an address inside a system (or of the system itself). */
export function card(system: StarSystem, address: Address): Card {
  const addr = formatAddress(address);
  const b = address.body;
  if (b === undefined) {
    const stars = system.stars.map((s) => s.label).join(' + ');
    return {
      title: system.name,
      subtitle: `sistema ${system.code}`,
      rows: [
        ['stelle', stars],
        ['pianeti', String(system.planets.length)],
        ['lune', String(system.planets.reduce((n, p) => n + p.moons.length, 0))],
        ['fasce, comete', `${system.belts.length}, ${system.comets.length}`],
        ['zona abitabile', `${num(system.habitable[0])}-${num(system.habitable[1])} UA`],
        ['settore', `${system.sx}, ${system.sy}`],
      ],
      address: addr,
    };
  }
  switch (b.kind) {
    case 'star': {
      const s = system.stars[b.index];
      return {
        title: s.name,
        subtitle: `${STAR_NAMES[s.class]} ${s.label}`,
        rows: [
          ['temperatura', `${s.temperature} K`],
          ['massa', `${num(s.mass)} soli`],
          ['luminosità', `${num(s.luminosity, 3)} soli`],
          ['raggio', `${num(s.radius / 0.00465, 2)} soli`],
          ['rotazione', duration(s.rotation.period)],
        ],
        address: addr,
      };
    }
    case 'belt': {
      const belt = system.belts[b.index];
      return { title: belt.name, subtitle: BELT_NAMES[belt.material], rows: [['distanza', `${num(belt.inner)}-${num(belt.outer)} UA`]], address: addr };
    }
    case 'comet': {
      const c = system.comets[b.index];
      return {
        title: c.name,
        subtitle: 'cometa',
        rows: [
          ['perielio', `${num(c.orbit.a * (1 - c.orbit.e))} UA`],
          ['afelio', `${num(c.orbit.a * (1 + c.orbit.e))} UA`],
          ['eccentricità', num(c.orbit.e)],
          ['periodo', duration(c.orbit.period)],
        ],
        address: addr,
      };
    }
    default: {
      const p = system.planets[b.index];
      if (b.moon !== undefined) {
        const m = p.moons[b.moon];
        return {
          title: m.name,
          subtitle: `luna, ${ARCHETYPE_NAMES[m.archetype]}`,
          rows: [
            ['raggio', `${num(m.radius)} terre`],
            ['orbita', `${num(m.orbit.a, 1)} raggi di ${p.name.slice(p.name.lastIndexOf(' ') + 1)}`],
            ['periodo', duration(m.orbit.period)],
            ['rotazione', 'sincrona'],
          ],
          address: addr,
        };
      }
      const rows: [string, string][] = [
        ['classe', ARCHETYPE_NAMES[p.archetype]],
        ['zona', ZONE_NAMES[p.zone]],
        ['raggio', `${num(p.radius)} terre`],
        ['distanza', `${num(p.orbit.a)} UA`],
        ['anno', duration(p.orbit.period)],
        ['giorno', duration(p.rotation.period)],
        ['lune', String(p.moons.length)],
      ];
      if (p.rings) rows.push(['anelli', 'sì']);
      return { title: p.properName ?? p.name, subtitle: p.properName === null ? ARCHETYPE_NAMES[p.archetype] : p.name, rows, address: addr };
    }
  }
}

export interface SearchResult {
  readonly label: string;
  readonly address: string;
}

/**
 * Systems whose name or catalogue code contains `query`, nearest to (cx, cy) first: sectors are
 * scanned in rings of growing distance, up to `limit` results or `maxSectors` sectors.
 */
export function searchSystems(galaxy: Galaxy, query: string, cx: number, cy: number, limit = 10, maxSectors = 400000): SearchResult[] {
  const q = foldName(query.trim());
  const code = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const out: SearchResult[] = [];
  const extent = Math.ceil(galaxy.shape.radius * 1.25);
  let visited = 0;
  for (let ring = 0; ring <= 2 * extent && out.length < limit && visited < maxSectors; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const sx = cx + dx;
        const sy = cy + dy;
        if (Math.abs(sx) > extent || Math.abs(sy) > extent) continue;
        visited++;
        const info = galaxy.sector(sx, sy);
        if (info.count === 0) continue;
        sectorNames(info).forEach((n, i) => {
          if (out.length >= limit) return;
          if (foldName(n.name).includes(q) || n.code.includes(code)) {
            out.push({ label: `${n.name} (${n.code})`, address: formatAddress({ galaxy: galaxy.seed, sector: { sx, sy }, system: i }) });
          }
        });
      }
    }
  }
  return out;
}
