// Generator registry: name, version, recipe schema, generate function and validators.
// The registry resolves recipes (defaults + validation) and handles deterministic retries,
// so generators only describe one attempt.

import type { IndexedBuffer } from '../core/buffer';
import { derive } from '../core/hash';
import { lightFromAngle, type Vec3 } from '../toolkit/light';
import { parseRecipe, type Fields, type Infer, type ObjectField } from './schema';

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

/** Data derived from the same generation: radius, classification, notable points... JSON only. */
export type Descriptor = { readonly [key: string]: Json };

export interface GenerateOptions {
  /**
   * Size of the object in pixels at this zoom step (a planet's diameter). The buffer may be
   * larger (rings, outline, glow); the descriptor says where the object sits in it.
   */
  size: number;
  /** Integer animation frame (tick). */
  frame: number;
  /** Unit direction towards the light, screen coordinates (x right, y down, z to the viewer). */
  lightDir: Vec3;
}

export interface GenResult {
  buffer: IndexedBuffer;
  descriptor: Descriptor;
}

/**
 * Rejects ugly results: returns a reason, or null when the result is fine. Validators read only
 * the descriptor, so generators with `describe` are judged without drawing a pixel.
 */
export interface Validator<R> {
  readonly name: string;
  check(result: { readonly descriptor: Descriptor }, recipe: R): string | null;
}

/** One fixed (recipe, seed, options) combination whose output is pinned by `forge golden`. */
export interface GoldenCase {
  readonly seed: number;
  readonly recipe?: Json;
  readonly size?: number;
  readonly frame?: number;
  /** Light azimuth in degrees (see lightFromAngle); elevation is the default. */
  readonly light?: number;
}

export interface GeneratorDef<F extends Fields> {
  readonly name: string;
  /** Bump when the output changes on purpose (id "name@version"). */
  readonly version: number;
  readonly description: string;
  readonly recipe: ObjectField<F>;
  /**
   * Turns the raw recipe input into the one the schema validates, before defaults: presets,
   * archetypes picked from the seed... Receives the requested seed, never a retry seed, so
   * retries keep what it chose. Default: the input unchanged.
   */
  resolve?(input: unknown, seed: number): unknown;
  readonly sizes: { readonly default: number; readonly min: number; readonly max: number };
  /** Frames in one animation loop, used by `forge anim` by default. */
  readonly loop: number;
  /** Default light, degrees (see lightFromAngle); default azimuth 315, elevation 40. */
  readonly light?: { readonly azimuth: number; readonly elevation: number };
  generate(recipe: Infer<ObjectField<F>>, seed: number, opts: GenerateOptions): GenResult;
  /**
   * The descriptor fields that do not depend on size, frame or light, without rasterising.
   * When present, validators judge this instead of a canonical render, so it must contain every
   * field they read, with the same values `generate` would put in its descriptor.
   */
  describe?(recipe: Infer<ObjectField<F>>, seed: number): Descriptor;
  readonly validators?: readonly Validator<Infer<ObjectField<F>>>[];
  /** Attempts before giving up, including the first. Default 8. */
  readonly maxAttempts?: number;
  readonly goldens: readonly GoldenCase[];
}

/** Keeps the recipe type tied to the schema; the registry itself stores erased definitions. */
export function defineGenerator<F extends Fields>(def: GeneratorDef<F>): GeneratorDef<Fields> {
  return def as unknown as GeneratorDef<Fields>;
}

export type Recipe = Infer<ObjectField<Fields>>;

export const DEFAULT_AZIMUTH = 315;
export const DEFAULT_ELEVATION = 40;
export const DEFAULT_LIGHT = lightFromAngle(DEFAULT_AZIMUTH, DEFAULT_ELEVATION);

export interface Rejection {
  readonly attempt: number;
  readonly seed: number;
  readonly reasons: readonly { readonly validator: string; readonly reason: string }[];
}

/** Which attempt of a (recipe, seed) passes the validators. */
export interface Selection {
  /** "name@version". */
  readonly id: string;
  /** Resolved recipe, defaults included. */
  readonly recipe: Recipe;
  /** Requested seed. */
  readonly seed: number;
  /** Seed of the accepted attempt: the requested one, or derive(seed, "retry", attempt). */
  readonly seedUsed: number;
  readonly attempt: number;
  /** False when every attempt failed validation; the first attempt is used then. */
  readonly accepted: boolean;
  readonly rejections: readonly Rejection[];
}

export interface RunResult extends GenResult, Selection {
  readonly opts: GenerateOptions;
}

/** Default light angles of a generator. */
export function defaultLight(def: GeneratorDef<Fields>): { azimuth: number; elevation: number } {
  return { azimuth: def.light?.azimuth ?? DEFAULT_AZIMUTH, elevation: def.light?.elevation ?? DEFAULT_ELEVATION };
}

export function generatorId(def: GeneratorDef<Fields>): string {
  return `${def.name}@${def.version}`;
}

/** Seed of retry attempt n: the seed itself first, then derive(seed, "retry", n). */
export function attemptSeed(seed: number, attempt: number): number {
  return attempt === 0 ? seed >>> 0 : derive(seed, 'retry', attempt);
}

/** Selections remembered by the registry; a hit returns exactly what selecting again would. */
const SELECTION_MEMO = 4096;

export class Registry {
  private readonly defs: readonly GeneratorDef<Fields>[];
  private readonly memo = new Map<string, Selection>();

  constructor(defs: readonly GeneratorDef<Fields>[]) {
    const names = new Set<string>();
    for (const d of defs) {
      if (!/^[a-z][a-z0-9-]*$/.test(d.name)) throw new Error(`generator name "${d.name}" must be lowercase letters, digits and dashes`);
      if (names.has(d.name)) throw new Error(`generator "${d.name}" registered twice`);
      if (!Number.isInteger(d.version) || d.version < 1) throw new Error(`${d.name}: version must be a positive integer`);
      names.add(d.name);
    }
    this.defs = [...defs].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Generators sorted by name. */
  list(): readonly GeneratorDef<Fields>[] {
    return this.defs;
  }

  get(name: string): GeneratorDef<Fields> {
    const def = this.defs.find((d) => d.name === name);
    if (def === undefined) {
      const known = this.defs.map((d) => d.name).join(', ');
      throw new Error(`generatore sconosciuto "${name}"; registrati: ${known}`);
    }
    return def;
  }

  /** Validated recipe with defaults, after the generator's resolve step; throws RecipeError. */
  recipe(name: string, input: unknown, seed = 0): Recipe {
    const def = this.get(name);
    return parseRecipe(def.recipe, def.resolve === undefined ? input : def.resolve(input, seed >>> 0));
  }

  /** Options with defaults filled in and checked against the generator's limits. */
  options(name: string, partial: Partial<GenerateOptions> = {}): GenerateOptions {
    const def = this.get(name);
    const size = partial.size ?? def.sizes.default;
    const frame = partial.frame ?? 0;
    if (!Number.isInteger(size) || size < def.sizes.min || size > def.sizes.max) {
      throw new RangeError(`${def.name}: la dimensione deve essere un intero tra ${def.sizes.min} e ${def.sizes.max}, ricevuto ${size}`);
    }
    if (!Number.isSafeInteger(frame)) throw new RangeError(`${def.name}: il frame deve essere un intero, ricevuto ${frame}`);
    const light = defaultLight(def);
    return { size, frame, lightDir: partial.lightDir ?? lightFromAngle(light.azimuth, light.elevation) };
  }

  /**
   * Chooses the attempt for a (recipe, seed). Validators judge a canonical render (default size,
   * frame 0, the generator's default light), so the choice depends only on recipe and seed: the same object keeps
   * its identity across zoom steps, frames and lights.
   */
  select(name: string, recipeInput: unknown, seed: number): Selection & { readonly canonical?: GenResult } {
    const def = this.get(name);
    const key = `${name}|${seed >>> 0}|${JSON.stringify(recipeInput ?? null)}`;
    const known = this.memo.get(key);
    if (known !== undefined) return known;
    const recipe = this.recipe(name, recipeInput, seed);
    const validators = def.validators ?? [];
    const base = { id: generatorId(def), recipe, seed: seed >>> 0 };
    let result: Selection & { readonly canonical?: GenResult } = { ...base, seedUsed: attemptSeed(seed, 0), attempt: 0, accepted: true, rejections: [] };
    if (validators.length > 0) {
      const canonical = this.options(name, {});
      const rejections: Rejection[] = [];
      const maxAttempts = def.maxAttempts ?? 8;
      result = { ...base, seedUsed: attemptSeed(seed, 0), attempt: 0, accepted: false, rejections };
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const s = attemptSeed(seed, attempt);
        const judged = def.describe !== undefined ? { descriptor: def.describe(recipe, s) } : def.generate(recipe, s, canonical);
        const reasons = [];
        for (const v of validators) {
          const reason = v.check(judged, recipe);
          if (reason !== null) reasons.push({ validator: v.name, reason });
        }
        if (reasons.length === 0) {
          result = { ...base, seedUsed: s, attempt, accepted: true, rejections, ...('buffer' in judged ? { canonical: judged } : {}) };
          break;
        }
        rejections.push({ attempt, seed: s, reasons });
      }
    }
    // Only the selection is remembered, never a canonical render: renders stay cheap to drop.
    const { canonical: _, ...selection } = result;
    if (this.memo.size >= SELECTION_MEMO) this.memo.delete(this.memo.keys().next().value as string);
    this.memo.set(key, selection);
    return result;
  }

  /** Generates an object: select the attempt, then render it with the requested options. */
  run(name: string, recipeInput: unknown, seed: number, partial: Partial<GenerateOptions> = {}): RunResult {
    return this.runMany(name, recipeInput, seed, [partial])[0];
  }

  /** Several renders of one object (frames, sizes, lights), validated once. */
  runMany(name: string, recipeInput: unknown, seed: number, partials: readonly Partial<GenerateOptions>[]): RunResult[] {
    const def = this.get(name);
    const { canonical, ...selection } = this.select(name, recipeInput, seed);
    const reference = this.options(name, {});
    return partials.map((partial) => {
      const opts = this.options(name, partial);
      const same =
        opts.size === reference.size &&
        opts.frame === reference.frame &&
        opts.lightDir.x === reference.lightDir.x &&
        opts.lightDir.y === reference.lightDir.y &&
        opts.lightDir.z === reference.lightDir.z;
      const result = same && canonical !== undefined ? canonical : def.generate(selection.recipe, selection.seedUsed, opts);
      return { ...result, ...selection, opts };
    });
  }
}
