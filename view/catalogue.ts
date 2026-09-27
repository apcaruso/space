// Catalogue of the galaxy: position, class and luminosity of every system, in typed arrays by
// bands of sector rows. The explorer draws the galaxy and regions from it without generating
// systems; the browser builds bands in a worker and shows them as they arrive.

import type { Galaxy } from '../universe/galaxy';
import { STAR_CLASS_IDS } from '../universe/stars';
import { systemSummary } from '../universe/system';

/** Sector rows per band. */
export const BAND_ROWS = 16;

export interface Band {
  readonly index: number;
  /** First sector column and row, and the number of columns. */
  readonly sx0: number;
  readonly sy0: number;
  readonly width: number;
  /** Systems of sector (col, row) are start[k]..start[k+1]-1 with k = row * width + col. */
  readonly start: Uint32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Index in STAR_CLASS_IDS of the brightest star. */
  readonly cls: Uint8Array;
  readonly lum: Float32Array;
  /** Stars in the system (1..3). */
  readonly stars: Uint8Array;
  /** Class of the companion (255 = none). */
  readonly companion: Uint8Array;
}

/** Sectors from the centre to the edge of the catalogue: the disc and its halo of clusters. */
export function catalogueExtent(galaxy: Galaxy): number {
  return Math.ceil(galaxy.shape.radius * 1.25);
}

export function bandCount(galaxy: Galaxy): number {
  return Math.ceil((2 * catalogueExtent(galaxy)) / BAND_ROWS);
}

/** Every system of one band of sector rows. */
export function buildBand(galaxy: Galaxy, index: number): Band {
  const extent = catalogueExtent(galaxy);
  const sx0 = -extent;
  const sy0 = -extent + index * BAND_ROWS;
  const width = 2 * extent;
  const start = new Uint32Array(width * BAND_ROWS + 1);
  const xs: number[] = [];
  const ys: number[] = [];
  const cls: number[] = [];
  const lum: number[] = [];
  const stars: number[] = [];
  const companion: number[] = [];
  for (let row = 0; row < BAND_ROWS; row++) {
    for (let col = 0; col < width; col++) {
      start[row * width + col] = xs.length;
      const info = galaxy.sector(sx0 + col, sy0 + row);
      for (let i = 0; i < info.count; i++) {
        const s = systemSummary(info, i);
        xs.push(s.position.x);
        ys.push(s.position.y);
        cls.push(STAR_CLASS_IDS.indexOf(s.stars[0].class));
        lum.push(s.stars[0].luminosity);
        stars.push(s.stars.length);
        companion.push(s.stars.length > 1 ? STAR_CLASS_IDS.indexOf(s.stars[1].class) : 255);
      }
    }
  }
  start[width * BAND_ROWS] = xs.length;
  return {
    index,
    sx0,
    sy0,
    width,
    start,
    x: Float32Array.from(xs),
    y: Float32Array.from(ys),
    cls: Uint8Array.from(cls),
    lum: Float32Array.from(lum),
    stars: Uint8Array.from(stars),
    companion: Uint8Array.from(companion),
  };
}

/** Called for each system in a rectangle: sector, index in the sector, offset, class, luminosity. */
export type SystemVisitor = (sx: number, sy: number, i: number, x: number, y: number, cls: number, lum: number, stars: number, companion: number) => void;

export class Catalogue {
  readonly extent: number;
  readonly bands: (Band | null)[];
  /** Asked for a band that is missing; returns it at once (Node) or null (it will arrive later). */
  private readonly load: (index: number) => Band | null;

  constructor(galaxy: Galaxy, load: (index: number) => Band | null) {
    this.extent = catalogueExtent(galaxy);
    this.bands = Array.from({ length: bandCount(galaxy) }, () => null);
    this.load = load;
  }

  /** Bands asked for and not delivered yet (browser). */
  readonly waiting = new Set<number>();

  add(band: Band): void {
    this.bands[band.index] = band;
    this.waiting.delete(band.index);
  }

  get complete(): boolean {
    return this.bands.every((b) => b !== null);
  }

  get loaded(): number {
    return this.bands.filter((b) => b !== null).length;
  }

  /** Visits the systems of the sectors overlapping a rectangle in global sector units. */
  visit(x0: number, y0: number, x1: number, y1: number, fn: SystemVisitor): void {
    const e = this.extent;
    const sxa = Math.max(-e, Math.floor(x0));
    const sxb = Math.min(e - 1, Math.floor(x1));
    const sya = Math.max(-e, Math.floor(y0));
    const syb = Math.min(e - 1, Math.floor(y1));
    if (sxa > sxb || sya > syb) return;
    for (let bi = Math.floor((sya + e) / BAND_ROWS); bi <= Math.floor((syb + e) / BAND_ROWS); bi++) {
      let band = this.bands[bi];
      if (band === null) {
        band = this.load(bi);
        if (band === null) {
          this.waiting.add(bi);
          continue;
        }
        this.bands[bi] = band;
      }
      const ra = Math.max(0, sya - band.sy0);
      const rb = Math.min(BAND_ROWS - 1, syb - band.sy0);
      for (let row = ra; row <= rb; row++) {
        const sy = band.sy0 + row;
        const k0 = row * band.width + (sxa - band.sx0);
        const k1 = row * band.width + (sxb - band.sx0);
        for (let k = k0; k <= k1; k++) {
          const sx = band.sx0 + (k - row * band.width);
          const a = band.start[k];
          const b = band.start[k + 1];
          for (let j = a; j < b; j++) fn(sx, sy, j - a, band.x[j], band.y[j], band.cls[j], band.lum[j], band.stars[j], band.companion[j]);
        }
      }
    }
  }

  /** Total systems in the loaded bands. */
  get systems(): number {
    let n = 0;
    for (const b of this.bands) if (b !== null) n += b.x.length;
    return n;
  }
}

/** Band as transferable arrays for postMessage. */
export function bandBuffers(b: Band): ArrayBuffer[] {
  return [b.start.buffer, b.x.buffer, b.y.buffer, b.cls.buffer, b.lum.buffer, b.stars.buffer, b.companion.buffer] as ArrayBuffer[];
}
