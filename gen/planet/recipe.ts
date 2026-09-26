// Planet recipe: one schema for every archetype. Presets in recipes/planets/ override parts of
// it; "auto" picks archetype and variant from the requested seed.

import { derive } from '../../core/hash';
import { Rng } from '../../core/rng';
import cratered from '../../recipes/planets/cratered.json';
import crateredIce from '../../recipes/planets/cratered-ice.json';
import dead from '../../recipes/planets/dead.json';
import deadBasalt from '../../recipes/planets/dead-basalt.json';
import desertRed from '../../recipes/planets/desert-red.json';
import desert from '../../recipes/planets/desert.json';
import gasCold from '../../recipes/planets/gas-cold.json';
import gasViolet from '../../recipes/planets/gas-violet.json';
import gasWarm from '../../recipes/planets/gas-warm.json';
import ice from '../../recipes/planets/ice.json';
import lava from '../../recipes/planets/lava.json';
import ocean from '../../recipes/planets/ocean.json';
import terran from '../../recipes/planets/terran.json';
import toxic from '../../recipes/planets/toxic.json';
import { masterPalette } from '../../toolkit/palette';
import { bool, choice, int, num, obj, type Infer } from '../schema';

export const ARCHETYPES = ['terran', 'ocean', 'desert', 'ice', 'lava', 'toxic', 'gas', 'cratered', 'dead'] as const;
export type Archetype = (typeof ARCHETYPES)[number];

const RAMPS = masterPalette().ramps.map((r) => r.name);
const ramp = (def: string, doc: string) => choice(RAMPS, def, doc);

export const planetRecipe = obj({
  archetype: choice([...ARCHETYPES, 'auto'], 'auto', 'archetipo; auto = scelto dal seed'),
  surface: obj({
    kind: choice(['terrain', 'bands', 'craters'], 'terrain', 'terreno a rumore, bande di un gigante gassoso, crateri'),
    scale: num(1.8, 0.3, 12, 'frequenza del rumore sulla sfera'),
    octaves: int(5, 1, 8, 'ottave alla dimensione piena (meno sotto i 64 px)'),
    gain: num(0.5, 0.2, 0.8, 'guadagno tra ottave'),
    warp: num(0.4, 0, 3, 'domain warp, in dimensioni dei dettagli'),
  }),
  levels: obj({
    sea: num(0.5, 0, 1, 'sotto: liquido (altezza normalizzata 0..1)'),
    shallows: num(0.06, 0, 0.3, 'fascia di liquido basso sotto il livello del mare'),
    high: num(0.72, 0, 1, 'sopra: altopiani'),
    cracks: num(0, 0, 0.5, 'larghezza della rete di crepe sulla terra (0 = nessuna)'),
  }),
  ramps: obj({
    liquid: ramp('ocean', 'liquido profondo'),
    shallows: ramp('coast', 'liquido basso'),
    lowland: ramp('vegetation', 'pianure, o bande del gigante gassoso'),
    highland: ramp('rock', 'altopiani'),
    cap: ramp('ice', 'calotte polari'),
    crack: ramp('magma', 'crepe'),
  }),
  emissive: obj({
    liquid: int(0, 0, 4, 'livello minimo di luce del liquido (magma che brilla)'),
    shallows: int(0, 0, 4, 'livello minimo di luce del liquido basso'),
    crack: int(0, 0, 4, 'livello minimo di luce delle crepe'),
  }),
  caps: obj({
    size: num(0.12, 0, 1, 'estensione delle calotte (0 = nessuna)'),
    heightBias: num(0.5, 0, 2, 'quanto le alture allargano le calotte'),
  }),
  relief: num(0.08, 0, 0.3, 'rilievo della terra, in frazione del raggio'),
  bands: obj({
    count: num(7, 2, 20, 'bande per emisfero (giganti gassosi)'),
    turbulence: num(0.35, 0, 1.5, 'ondulazione dei bordi delle bande'),
    storms: int(2, 0, 6, 'tempeste ovali'),
    stormRamp: ramp('magma', 'rampa delle tempeste'),
  }),
  craters: obj({
    density: num(3, 1, 10, 'celle di crateri per raggio'),
    size: num(0.7, 0.2, 1, 'raggio dei crateri, in frazione della cella'),
    depth: num(0.6, 0, 1, 'profondità dei crateri'),
  }),
  clouds: obj({
    coverage: num(0.35, 0, 0.9, 'frazione di cielo coperta (0 = nessuna nuvola)'),
    ramp: ramp('cloud', 'rampa delle nuvole'),
    scale: num(2.2, 0.5, 10, 'frequenza del rumore delle nuvole'),
    octaves: int(4, 1, 8, 'ottave delle nuvole'),
    stretch: num(2, 1, 6, 'allungamento lungo i paralleli'),
    period: int(48, 8, 4096, 'frame per un giro delle nuvole; un divisore del giro della superficie tiene il loop'),
  }),
  atmosphere: obj({
    strength: num(0.6, 0, 1, 'bordo d\'atmosfera sul lato illuminato (0 = nessuno)'),
    ramp: ramp('coast', 'rampa dell\'atmosfera'),
  }),
  rings: obj({
    chance: num(0, 0, 1, 'probabilità di avere anelli (1 = sempre)'),
    ramp: ramp('sand', 'rampa degli anelli'),
    inner: num(1.35, 1.05, 2.5, 'raggio interno, in raggi del pianeta'),
    outer: num(2.1, 1.2, 3, 'raggio esterno, in raggi del pianeta'),
    gaps: num(0.3, 0, 0.9, 'quota di divisioni vuote'),
  }),
  axis: obj({
    roll: num(18, 0, 45, 'inclinazione massima dell\'asse sullo schermo, gradi'),
    lean: num(15, 0, 40, 'inclinazione massima del polo verso chi guarda, gradi'),
  }),
  period: int(96, 8, 4096, 'frame per una rotazione della superficie'),
  limits: obj({
    landMin: num(0, 0, 1, 'validatore: terra minima'),
    landMax: num(1, 0, 1, 'validatore: terra massima'),
  }),
  outline: bool(true, 'outline scuro attorno al disco'),
});

export type PlanetRecipe = Infer<typeof planetRecipe>;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Presets by archetype; archetypes with several variants pick one from the seed. */
const PRESETS: Record<Archetype, readonly Json[]> = {
  terran: [terran],
  ocean: [ocean],
  desert: [desert, desertRed],
  ice: [ice],
  lava: [lava],
  toxic: [toxic],
  gas: [gasWarm, gasCold, gasViolet],
  cratered: [cratered, crateredIce],
  dead: [dead, deadBasalt],
};

/** Relative frequency of each archetype when the recipe says "auto". */
const WEIGHTS: Record<Archetype, number> = {
  terran: 2,
  ocean: 1,
  desert: 1.5,
  ice: 1.5,
  lava: 1,
  toxic: 1,
  gas: 2,
  cratered: 2,
  dead: 1.5,
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** `over` on top of `base`, recursively for objects. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(over).sort()) out[k] = deepMerge(base[k], over[k]);
  return out;
}

export function pickArchetype(seed: number): Archetype {
  const rng = new Rng(derive(seed, 'archetype'));
  const total = ARCHETYPES.reduce((sum, a) => sum + WEIGHTS[a], 0);
  let t = rng.float() * total;
  for (const a of ARCHETYPES) {
    t -= WEIGHTS[a];
    if (t < 0) return a;
  }
  return ARCHETYPES[ARCHETYPES.length - 1];
}

/** Archetype (from the input or the seed), then its preset variant, then the input on top. */
export function resolvePlanet(input: unknown, seed: number): unknown {
  const requested = isObject(input) ? input.archetype : undefined;
  const known = (ARCHETYPES as readonly unknown[]).includes(requested);
  if (requested !== undefined && requested !== 'auto' && !known) return input; // let the schema report it
  const archetype = known ? (requested as Archetype) : pickArchetype(seed);
  const variants = PRESETS[archetype];
  const preset = variants[new Rng(derive(seed, 'variant')).int(0, variants.length - 1)];
  return deepMerge(preset, { ...(isObject(input) ? input : {}), archetype });
}
