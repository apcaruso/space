// Sprites for the explorer: requests, cache keys, quantised light, an LRU cache bounded by
// memory, and the synchronous source used in Node (forge view). The browser's source lives in
// app/ and generates in Web Workers; both answer the same interface.

import { IndexedBuffer } from '../core/buffer';
import { atan2, cos, log, PI, sin, TAU } from '../core/dmath';
import { registry } from '../gen/index';
import type { Descriptor } from '../gen/registry';
import { direction, type Vec3 } from '../toolkit/light';

export interface SpriteRequest {
  readonly gen: string;
  readonly recipe: Readonly<Record<string, unknown>>;
  readonly seed: number;
  /** A size step of the generator. */
  readonly size: number;
  readonly frame: number;
  /** Light direction bin (0..LIGHT_BINS-1), or -1 for the generator's default light. */
  readonly light: number;
}

export interface Sprite {
  readonly buffer: IndexedBuffer;
  /** Centre of the object in the buffer. */
  readonly cx: number;
  readonly cy: number;
  readonly descriptor: Descriptor;
}

/** Light directions are quantised so relit sprites can be cached. */
export const LIGHT_BINS = 32;
const LIGHT_ELEVATION = (20 * PI) / 180;

/** Bin of the direction (dx, dy) on the screen, from the lit body towards its star. */
export function lightBin(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return -1;
  const a = atan2(dy, dx);
  return ((Math.round((a / TAU) * LIGHT_BINS) % LIGHT_BINS) + LIGHT_BINS) % LIGHT_BINS;
}

const lightVectors = Array.from({ length: LIGHT_BINS }, (_, i) => {
  const a = (TAU * i) / LIGHT_BINS;
  return direction(cos(a) * cos(LIGHT_ELEVATION), sin(a) * cos(LIGHT_ELEVATION), sin(LIGHT_ELEVATION));
});

export function lightVector(bin: number): Vec3 | undefined {
  return bin < 0 ? undefined : lightVectors[bin];
}

/** JSON with sorted keys: the same recipe always gives the same key. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const recipeKeys = new WeakMap<object, string>();

function recipeKey(recipe: object): string {
  let key = recipeKeys.get(recipe);
  if (key === undefined) {
    key = canonicalJson(recipe);
    recipeKeys.set(recipe, key);
  }
  return key;
}

const versions = new Map<string, number>();

function version(gen: string): number {
  let v = versions.get(gen);
  if (v === undefined) {
    v = registry.get(gen).version;
    versions.set(gen, v);
  }
  return v;
}

/** One object whatever its size, frame and light: generator@version, recipe, seed. */
export function objectKey(r: SpriteRequest): string {
  return `${r.gen}@${version(r.gen)}|${recipeKey(r.recipe)}|${r.seed >>> 0}`;
}

/** The cache key: object, size step, frame, light bin. */
export function spriteKey(r: SpriteRequest): string {
  return `${objectKey(r)}|${r.size}|${r.frame}|${r.light}`;
}

interface Entry {
  readonly sprite: Sprite;
  readonly bytes: number;
  readonly object: string;
  readonly size: number;
  readonly frame: number;
  readonly light: number;
  used: number;
}

/**
 * LRU cache of sprites bounded by bytes. Sprites used in the current frame are never evicted;
 * `nearest` finds the closest ready size of the same object for placeholders.
 */
export class SpriteCache {
  private readonly entries = new Map<string, Entry>();
  private readonly byObject = new Map<string, Set<string>>();
  private bytes = 0;
  private frame = 0;

  constructor(readonly maxBytes = 48 * 1024 * 1024) {}

  beginFrame(): void {
    this.frame++;
  }

  get(key: string): Sprite | undefined {
    const e = this.entries.get(key);
    if (e === undefined) return undefined;
    e.used = this.frame;
    // Most recently used last.
    this.entries.delete(key);
    this.entries.set(key, e);
    return e.sprite;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  set(req: SpriteRequest, sprite: Sprite): void {
    const key = spriteKey(req);
    if (this.entries.has(key)) return;
    const object = objectKey(req);
    const e: Entry = { sprite, bytes: sprite.buffer.w * sprite.buffer.h + 64, object, size: req.size, frame: req.frame, light: req.light, used: this.frame };
    this.entries.set(key, e);
    this.bytes += e.bytes;
    let set = this.byObject.get(object);
    if (set === undefined) {
      set = new Set();
      this.byObject.set(object, set);
    }
    set.add(key);
    this.evict();
  }

  private evict(): void {
    for (const [key, e] of this.entries) {
      if (this.bytes <= this.maxBytes) return;
      if (e.used === this.frame) continue;
      this.entries.delete(key);
      this.bytes -= e.bytes;
      const set = this.byObject.get(e.object);
      set?.delete(key);
      if (set !== undefined && set.size === 0) this.byObject.delete(e.object);
    }
  }

  /** Closest ready sprite of the same object: nearest size, then same frame, then same light. */
  nearest(req: SpriteRequest): Sprite | undefined {
    const set = this.byObject.get(objectKey(req));
    if (set === undefined) return undefined;
    let best: Entry | undefined;
    let bestScore = Infinity;
    for (const key of set) {
      const e = this.entries.get(key) as Entry;
      const score = Math.abs(log(e.size / req.size)) * 10 + (e.frame === req.frame ? 0 : 1) + (e.light === req.light ? 0 : 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (best !== undefined) best.used = this.frame;
    return best?.sprite;
  }

  stats(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.bytes };
  }
}

/** Where sprites come from: now (Node) or later (workers). */
export interface SpriteSource {
  /** The sprite if ready; otherwise asks for it and returns undefined. */
  get(req: SpriteRequest, priority?: number): Sprite | undefined;
  /** Best stand-in while `req` is not ready. */
  nearest(req: SpriteRequest): Sprite | undefined;
  /** Asks for a sprite that is not needed yet (next zoom step), at low priority. */
  prefetch(req: SpriteRequest): void;
  beginFrame(): void;
  endFrame(): void;
}

/** Generation time per generator, filled by whoever can read a clock. */
export interface GenerationStats {
  readonly count: Map<string, number>;
  readonly ms: Map<string, number>;
}

export function emptyStats(): GenerationStats {
  return { count: new Map(), ms: new Map() };
}

export function recordGeneration(stats: GenerationStats, gen: string, ms: number): void {
  stats.count.set(gen, (stats.count.get(gen) ?? 0) + 1);
  stats.ms.set(gen, (stats.ms.get(gen) ?? 0) + ms);
}

/** Generates one sprite with the registry. */
export function generateSprite(req: SpriteRequest): Sprite {
  const light = lightVector(req.light);
  const r = registry.run(req.gen, req.recipe, req.seed, { size: req.size, frame: req.frame, ...(light ? { lightDir: light } : {}) });
  const centre = Array.isArray(r.descriptor.centre) ? (r.descriptor.centre as number[]) : [r.buffer.w / 2, r.buffer.h / 2];
  return { buffer: r.buffer, cx: centre[0], cy: centre[1], descriptor: r.descriptor };
}

/**
 * Synchronous source for Node: every missing sprite is generated on the spot, so a frame is
 * always complete. `now` (a clock injected by the caller) feeds the generation statistics.
 */
export class SyncSprites implements SpriteSource {
  readonly cache: SpriteCache;
  readonly stats = emptyStats();

  constructor(
    private readonly now: () => number = () => 0,
    maxBytes?: number,
  ) {
    this.cache = new SpriteCache(maxBytes);
  }

  get(req: SpriteRequest): Sprite {
    const key = spriteKey(req);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const t0 = this.now();
    const sprite = generateSprite(req);
    recordGeneration(this.stats, req.gen, this.now() - t0);
    this.cache.set(req, sprite);
    return sprite;
  }

  nearest(req: SpriteRequest): Sprite | undefined {
    return this.cache.nearest(req);
  }

  prefetch(): void {}

  beginFrame(): void {
    this.cache.beginFrame();
  }

  endFrame(): void {}
}

/** Serialisable form of a sprite, for messages between workers and the page. */
export interface SpriteMessage {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
  readonly cx: number;
  readonly cy: number;
  readonly descriptor: Descriptor;
}

export function toMessage(s: Sprite): SpriteMessage {
  return { w: s.buffer.w, h: s.buffer.h, data: s.buffer.data, cx: s.cx, cy: s.cy, descriptor: s.descriptor };
}

export function fromMessage(m: SpriteMessage): Sprite {
  return { buffer: new IndexedBuffer(m.w, m.h, m.data), cx: m.cx, cy: m.cy, descriptor: m.descriptor };
}
