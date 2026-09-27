// Generated names: syllable grammars (one "language" per region of the galaxy), catalogue codes,
// letters and Roman numerals for bodies, and filters against real and offensive names.

import { derive } from '../core/hash';
import { Rng } from '../core/rng';

interface Grammar {
  readonly id: string;
  readonly onsets: readonly string[];
  readonly vowels: readonly string[];
  readonly codas: readonly string[];
  /** Chance that a syllable gets a coda. */
  readonly codaChance: number;
  readonly syllables: readonly [number, number];
  /** Joiner between syllables ("'" or "-"), used at most once, and its chance. */
  readonly joiner: string;
  readonly joinerChance: number;
  readonly endings: readonly string[];
  readonly endingChance: number;
}

/** Five languages; regions of the galaxy (see Galaxy.sector) pick one. */
export const GRAMMARS: readonly Grammar[] = [
  {
    id: 'liquida',
    onsets: ['v', 'l', 'm', 'n', 's', 'r', 't', 'd', 'c', 'f', 'b', 'gl', 'vr', 'st', ''],
    vowels: ['a', 'e', 'i', 'o', 'a', 'e', 'ia', 'ae'],
    codas: ['n', 'l', 'r', 's'],
    codaChance: 0.25,
    syllables: [2, 3],
    joiner: '',
    joinerChance: 0,
    endings: ['ra', 'na', 'ria', 'lis', 'ne', 'ssa', 'ro'],
    endingChance: 0.45,
  },
  {
    id: 'aspra',
    onsets: ['k', 'kr', 'z', 'x', 'g', 'dr', 'th', 'v', 't', 'gr', 'sk', 'b', 'h'],
    vowels: ['a', 'o', 'u', 'e', 'y', 'au'],
    codas: ['k', 'x', 'r', 'th', 'z', 'n', 'rn', 'sk'],
    codaChance: 0.55,
    syllables: [1, 2],
    joiner: "'",
    joinerChance: 0.25,
    endings: ['ax', 'or', 'uun', 'ek'],
    endingChance: 0.2,
  },
  {
    id: 'vocalica',
    onsets: ['h', 'k', 'l', 'm', 'n', 'p', 't', 'v', 'w', 'r', ''],
    vowels: ['a', 'e', 'i', 'o', 'u', 'ai', 'au', 'ei', 'oa'],
    codas: ['n'],
    codaChance: 0.08,
    syllables: [2, 4],
    joiner: '',
    joinerChance: 0,
    endings: [],
    endingChance: 0,
  },
  {
    id: 'sibilante',
    onsets: ['s', 'sh', 'z', 'ch', 'j', 'y', 'q', 'ss', 'zh', 'm', 'n'],
    vowels: ['a', 'i', 'e', 'u', 'aa', 'ii', 'ye'],
    codas: ['sh', 's', 'm', 'n', 'q', 'l'],
    codaChance: 0.4,
    syllables: [2, 3],
    joiner: "'",
    joinerChance: 0.15,
    endings: ['ir', 'ash', 'eem', 'un'],
    endingChance: 0.3,
  },
  {
    id: 'composta',
    onsets: ['t', 'd', 'p', 'b', 'c', 'f', 'm', 'n', 'v', 'br', 'tr', 'pr', 'cl', 'h'],
    vowels: ['a', 'e', 'i', 'o', 'u'],
    codas: ['r', 'n', 'l', 'm', 's', 'd', 'x'],
    codaChance: 0.6,
    syllables: [2, 3],
    joiner: '-',
    joinerChance: 0.7,
    endings: ['on', 'us', 'em', 'ar'],
    endingChance: 0.25,
  },
];

/**
 * Real star, planet and moon names (lower case, no accents), compared exactly. Generated names
 * must not pass for real bodies.
 */
const REAL_NAMES = new Set([
  'achernar', 'adrastea', 'aldebaran', 'alcor', 'algol', 'altair', 'amalthea', 'andromeda', 'antares', 'arcturus',
  'ariel', 'barnard', 'bellatrix', 'betelgeuse', 'callisto', 'canopus', 'capella', 'cassiopea', 'castor', 'centauri',
  'ceres', 'charon', 'deimos', 'deneb', 'dione', 'earth', 'elara', 'enceladus', 'epimetheus', 'eris',
  'europa', 'fomalhaut', 'ganymede', 'ganimede', 'giove', 'gliese', 'haumea', 'himalia', 'hydra', 'hygiea',
  'hyperion', 'iapetus', 'io', 'janus', 'juno', 'jupiter', 'kapteyn', 'kepler', 'kerberos', 'lalande',
  'luna', 'luyten', 'makemake', 'marte', 'mars', 'mercurio', 'mercury', 'metis', 'mimas', 'mira',
  'miranda', 'mizar', 'moon', 'nereid', 'nettuno', 'neptune', 'nix', 'oberon', 'orione', 'orion',
  'pallas', 'pandora', 'phobos', 'phoebe', 'pleiadi', 'pleiades', 'pluto', 'plutone', 'polaris', 'pollux',
  'procyon', 'proxima', 'puck', 'regulus', 'rhea', 'rigel', 'ross', 'saturn', 'saturno', 'sedna',
  'sirius', 'sirio', 'sol', 'sole', 'spica', 'styx', 'tethys', 'teti', 'thebe', 'titan',
  'titano', 'titania', 'trappist', 'triton', 'tritone', 'umbriel', 'urano', 'uranus', 'vega', 'venere',
  'venus', 'vesta', 'wolf', 'terra', 'sun',
]);

/**
 * Offensive stems in Italian and English, matched as substrings of the name without accents,
 * case, apostrophes and hyphens. False positives only cost a regeneration.
 */
const BLOCKED_STEMS = [
  // English
  'fuck', 'shit', 'cunt', 'cock', 'dick', 'piss', 'slut', 'whore', 'fag', 'nigg', 'nigr', 'rape', 'nazi', 'kike',
  'spic', 'twat', 'wank', 'bitch', 'bastard', 'penis', 'anus', 'porn', 'cum', 'arse', 'tits', 'homo', 'retard',
  'hitler', 'kkk', 'jizz', 'dildo', 'boob', 'semen', 'sex',
  // Italian
  'cazz', 'merd', 'stronz', 'puttan', 'troia', 'fica', 'figa', 'culo', 'mign', 'froci', 'negr', 'zoccol', 'vaffa',
  'coglion', 'minchi', 'bastard', 'porco', 'porca', 'fott', 'pompin', 'sborr', 'ricchion', 'terron', 'duce',
  'tette', 'scopa', 'suca', 'recchion', 'finocchi', 'mongol', 'handicap',
];

/** Lower case, accents and joiners removed: the form the filters compare. */
export function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['\- ]/g, '');
}

export function isRealName(name: string): boolean {
  return REAL_NAMES.has(foldName(name));
}

export function isOffensive(name: string): boolean {
  const f = foldName(name);
  return BLOCKED_STEMS.some((stem) => f.includes(stem));
}

export function isAcceptableName(name: string): boolean {
  return !isRealName(name) && !isOffensive(name);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One raw word from a grammar; no filtering. */
function word(g: Grammar, rng: Rng): string {
  const count = rng.int(g.syllables[0], g.syllables[1]);
  const joinAt = g.joiner !== '' && count > 1 && rng.chance(g.joinerChance) ? rng.int(1, count - 1) : -1;
  const ending = g.endings.length > 0 && rng.chance(g.endingChance) ? rng.pick(g.endings) : '';
  let out = '';
  for (let i = 0; i < count; i++) {
    if (i === joinAt) out += g.joiner;
    let onset = rng.pick(g.onsets);
    // No vowel clusters across syllables: an empty onset only at the start.
    if (onset === '' && i > 0) onset = g.onsets[0];
    out += onset + rng.pick(g.vowels);
    const last = i === count - 1;
    if (!(last && ending !== '') && rng.chance(g.codaChance)) out += rng.pick(g.codas);
  }
  out += ending;
  return out.split('-').map(capitalize).join('-');
}

/** Pronounceable: 3..10 letters, no letter three times in a row, short vowel and consonant runs. */
function wellFormed(name: string): boolean {
  const f = foldName(name);
  if (f.length < 3 || f.length > 10) return false;
  if (/(.)\1\1/.test(f)) return false;
  return !/[aeiouy]{3}/.test(f) && !/[^aeiouy]{4}/.test(f);
}

/**
 * A proper name in the given style, from `seed`. Rejected names (real, offensive, too short or
 * too long, or in `taken`) are regenerated from derive(seed, "name", n).
 */
export function properName(style: number, seed: number, taken: ReadonlySet<string> = new Set()): string {
  const g = GRAMMARS[((style % GRAMMARS.length) + GRAMMARS.length) % GRAMMARS.length];
  for (let n = 0; ; n++) {
    const name = word(g, new Rng(derive(seed, 'name', n)));
    if (wellFormed(name) && isAcceptableName(name) && !taken.has(name)) return name;
  }
}

// Catalogue codes: no I or O, so they never read as 1 or 0.
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Two catalogue letters of a sector, e.g. "KX". */
export function sectorLetters(sectorSeed: number): string {
  const rng = new Rng(derive(sectorSeed, 'code'));
  for (;;) {
    const s = rng.pick([...CODE_LETTERS]) + rng.pick([...CODE_LETTERS]);
    if (isAcceptableName(s)) return s;
  }
}

/** Distinct four-digit catalogue numbers for the systems of a sector, in system order. */
export function catalogNumbers(sectorSeed: number, count: number): number[] {
  const rng = new Rng(derive(sectorSeed, 'numbers'));
  const out: number[] = [];
  while (out.length < count) {
    const n = rng.int(1000, 9999);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

export function catalogCode(letters: string, number: number): string {
  return `${letters}-${String(number).padStart(4, '0')}`;
}

const PLANET_LETTERS = 'bcdefghijklmnopqrstuvwxyz';

/** Letters of planets in order of distance: b, c, d... z, bb, bc... ("a" is the star). */
export function planetLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = PLANET_LETTERS[n % 25] + s;
    n = Math.floor(n / 25) - 1;
  } while (n >= 0);
  return s;
}

/** Stars of a multiple system: A, B, C. */
export function starLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

export function roman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError(`roman: ${n} out of range`);
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}
