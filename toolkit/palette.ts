// The master palette: colours plus ramps (dark-to-light sequences of indices into the colours).
// Ramps may share colours, so an index can belong to several ramps; index-only operations use
// its home ramp, the first ramp that lists it.

import { IndexedBuffer } from '../core/buffer';
import masterData from '../style/palette.json';
import { hexToRgb8, rgb8ToOklab } from './color';

export interface RampData {
  name: string;
  tones: number[];
}

/** Serialised form, as in style/palette.json. colors[0] is null (transparent). */
export interface PaletteData {
  colors: (string | null)[];
  ramps: RampData[];
}

export interface Ramp {
  readonly id: number;
  readonly name: string;
  /** Palette indices, darkest first. */
  readonly indices: Uint8Array;
}

/** 256-entry lookup table from palette index to palette index. */
export type IndexTable = Uint8Array;

export interface CycleOptions {
  /** Frames per one-step shift. Default 1. */
  period?: number;
  /** Tone range that cycles, inclusive. Default: the whole ramp. */
  from?: number;
  to?: number;
}

// Out-of-range indices render magenta, so bugs show up instead of hiding.
const INVALID_RGBA = [255, 0, 255, 255] as const;

function fail(message: string): never {
  throw new RangeError(`palette: ${message}`);
}

export class Palette {
  /** Number of indices, including the transparent 0. */
  readonly size: number;
  readonly ramps: readonly Ramp[];
  /** RGBA for all 256 indices; unused ones are magenta. */
  private readonly rgba: Uint8Array;
  /** OKLab lightness per index (0 for transparent). */
  private readonly lightness: Float64Array;
  private readonly byName: Map<string, Ramp>;
  private readonly home: Int16Array;
  private readonly homeTone: Int16Array;
  /** size * size flags: 1 if two indices belong to a common ramp. */
  private readonly relatedFlags: Uint8Array;

  private constructor(data: PaletteData) {
    this.size = data.colors.length;
    this.rgba = new Uint8Array(256 * 4);
    this.lightness = new Float64Array(256);
    for (let i = 0; i < 256; i++) {
      const hex = i < this.size ? data.colors[i] : undefined;
      if (i === 0) continue;
      const rgb = typeof hex === 'string' ? hexToRgb8(hex) : undefined;
      const px = rgb === undefined ? INVALID_RGBA : [rgb[0], rgb[1], rgb[2], 255];
      this.rgba.set(px, i * 4);
      if (rgb !== undefined) this.lightness[i] = rgb8ToOklab(rgb)[0];
    }

    this.byName = new Map();
    this.home = new Int16Array(256).fill(-1);
    this.homeTone = new Int16Array(256).fill(-1);
    this.relatedFlags = new Uint8Array(this.size * this.size);
    this.ramps = data.ramps.map((r, id) => {
      const ramp: Ramp = { id, name: r.name, indices: Uint8Array.from(r.tones) };
      this.byName.set(r.name, ramp);
      r.tones.forEach((index, tone) => {
        if (this.home[index] === -1) {
          this.home[index] = id;
          this.homeTone[index] = tone;
        }
        for (const other of r.tones) this.relatedFlags[index * this.size + other] = 1;
      });
      return ramp;
    });
  }

  /** Validates serialised palette data and builds a Palette. */
  static fromData(data: unknown): Palette {
    if (typeof data !== 'object' || data === null) fail('data must be an object');
    const { colors, ramps } = data as Partial<PaletteData>;
    if (!Array.isArray(colors) || colors.length < 2 || colors.length > 256) fail('colors must have 2-256 entries');
    if (colors[0] !== null) fail('colors[0] must be null (transparent)');
    for (let i = 1; i < colors.length; i++) {
      const c = colors[i];
      if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/.test(c)) fail(`colors[${i}] must be #rrggbb`);
    }
    if (!Array.isArray(ramps) || ramps.length === 0) fail('ramps must be a non-empty array');
    const names = new Set<string>();
    for (const r of ramps) {
      if (typeof r?.name !== 'string' || r.name === '') fail('every ramp needs a name');
      if (names.has(r.name)) fail(`duplicate ramp ${r.name}`);
      names.add(r.name);
      if (!Array.isArray(r.tones) || r.tones.length < 2) fail(`${r.name}: needs at least 2 tones`);
      for (const t of r.tones) {
        if (!Number.isInteger(t) || t < 1 || t >= colors.length) fail(`${r.name}: tone index ${t} out of range`);
      }
      if (new Set(r.tones).size !== r.tones.length) fail(`${r.name}: repeated index`);
    }
    return new Palette({ colors, ramps } as PaletteData);
  }

  /** Ramp by name; throws if it does not exist. */
  ramp(name: string): Ramp {
    const ramp = this.byName.get(name);
    if (ramp === undefined) fail(`unknown ramp ${name}`);
    return ramp;
  }

  /** Index of `tone` in a ramp, clamped to the ramp's range. */
  index(ramp: string | Ramp, tone: number): number {
    const r = typeof ramp === 'string' ? this.ramp(ramp) : ramp;
    const t = tone < 0 ? 0 : tone >= r.indices.length ? r.indices.length - 1 : tone;
    return r.indices[t];
  }

  /** Darkest tone of a ramp: the outline colour of its material. */
  darkest(ramp: string | Ramp): number {
    return this.index(ramp, 0);
  }

  /** Darkest tone of every ramp, without repeats: the colours an outline can use. */
  darkestIndices(): number[] {
    return [...new Set(this.ramps.map((r) => r.indices[0]))];
  }

  /** Home ramp of an index (first ramp listing it), or undefined for transparent/unused. */
  homeRamp(index: number): Ramp | undefined {
    const id = this.home[index];
    return id >= 0 ? this.ramps[id] : undefined;
  }

  /** Tone of an index within its home ramp, or -1. */
  toneOf(index: number): number {
    return this.homeTone[index];
  }

  /** True if the two indices appear together in at least one ramp (same material family). */
  related(a: number, b: number): boolean {
    return a < this.size && b < this.size && this.relatedFlags[a * this.size + b] === 1;
  }

  /** OKLab lightness of an index, 0 for transparent. */
  lightnessOf(index: number): number {
    return this.lightness[index];
  }

  /** RGBA bytes of a buffer; transparent pixels get alpha 0. */
  toRGBA(buf: IndexedBuffer): Uint8ClampedArray {
    const out = new Uint8ClampedArray(buf.w * buf.h * 4);
    const src = buf.data;
    for (let i = 0; i < src.length; i++) {
      const c = src[i] * 4;
      const o = i * 4;
      out[o] = this.rgba[c];
      out[o + 1] = this.rgba[c + 1];
      out[o + 2] = this.rgba[c + 2];
      out[o + 3] = this.rgba[c + 3];
    }
    return out;
  }

  /** Table that leaves every index unchanged. */
  identityTable(): IndexTable {
    const table = new Uint8Array(256);
    for (let i = 0; i < 256; i++) table[i] = i;
    return table;
  }

  /**
   * Palette swap: every tone of `from` becomes the matching tone of `to` (by position, scaled
   * when the lengths differ). Other indices are unchanged.
   */
  swapTable(from: string | Ramp, to: string | Ramp): IndexTable {
    const a = typeof from === 'string' ? this.ramp(from) : from;
    const b = typeof to === 'string' ? this.ramp(to) : to;
    const table = this.identityTable();
    const na = a.indices.length;
    const nb = b.indices.length;
    for (let t = 0; t < na; t++) {
      const u = na === 1 ? 0 : Math.round((t * (nb - 1)) / (na - 1));
      table[a.indices[t]] = b.indices[u];
    }
    return table;
  }

  /**
   * Palette cycling: the tones of a ramp (or of a range of it) rotate by one step every
   * `period` frames. `frame` is an integer tick.
   */
  cycleTable(ramp: string | Ramp, frame: number, opts: CycleOptions = {}): IndexTable {
    const r = typeof ramp === 'string' ? this.ramp(ramp) : ramp;
    const from = opts.from ?? 0;
    const to = opts.to ?? r.indices.length - 1;
    const period = opts.period ?? 1;
    if (!Number.isInteger(frame) || !Number.isInteger(period) || period < 1) fail('cycleTable needs integer frame and period >= 1');
    if (from < 0 || to >= r.indices.length || from >= to) fail(`cycleTable: bad tone range ${from}..${to}`);
    const span = to - from + 1;
    const shift = ((Math.floor(frame / period) % span) + span) % span;
    const table = this.identityTable();
    for (let i = 0; i < span; i++) table[r.indices[from + i]] = r.indices[from + ((i + shift) % span)];
    return table;
  }

  /**
   * Light table: moves every index `delta` tones along its home ramp (positive = lighter),
   * clamped at the ends. Darkens or lightens a finished image without alpha blending;
   * transparent stays transparent and nothing becomes transparent.
   */
  lightTable(delta: number): IndexTable {
    const table = this.identityTable();
    for (let i = 1; i < this.size; i++) {
      const ramp = this.homeRamp(i);
      if (ramp !== undefined) table[i] = this.index(ramp, this.homeTone[i] + delta);
    }
    return table;
  }
}

/** New buffer with every pixel mapped through `table`. */
export function applyTable(buf: IndexedBuffer, table: IndexTable): IndexedBuffer {
  const out = new IndexedBuffer(buf.w, buf.h);
  for (let i = 0; i < buf.data.length; i++) out.data[i] = table[buf.data[i]];
  return out;
}

/** Table equivalent to applying `first`, then `second`. */
export function composeTables(first: IndexTable, second: IndexTable): IndexTable {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) table[i] = second[first[i]];
  return table;
}

let master: Palette | undefined;

/** The palette in style/palette.json, parsed on first use. */
export function masterPalette(): Palette {
  master ??= Palette.fromData(masterData);
  return master;
}

