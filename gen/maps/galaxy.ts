// Galaxy maps: the whole galaxy at one pixel per sector, or a region with one block of pixels
// per sector and every system as a dot coloured by its star class.

import { IndexedBuffer } from '../../core/buffer';
import { BAYER4, bayerThreshold, ditherQuantize } from '../../toolkit/dither';
import { masterPalette } from '../../toolkit/palette';
import { nebulaRamps, type Galaxy, type SectorInfo } from '../../universe/galaxy';
import { systemSummary } from '../../universe/system';

const palette = masterPalette();

/** Map colour of each star class: ramp and three tones, dim to bright. */
export const STAR_COLOURS: Readonly<Record<string, readonly [string, readonly [number, number, number]]>> = {
  O: ['energy', [1, 2, 3]],
  B: ['ice', [1, 2, 3]],
  A: ['cloud', [1, 2, 3]],
  F: ['sand', [1, 2, 3]],
  G: ['ui-warm', [1, 2, 3]],
  K: ['magma', [1, 2, 3]],
  M: ['magma', [0, 1, 2]],
  'white-dwarf': ['ice', [1, 2, 3]],
  'red-giant': ['magma', [1, 2, 3]],
  neutron: ['crystal-magenta', [1, 2, 3]],
};

export function starColour(cls: string, tone: 0 | 1 | 2): number {
  const [ramp, tones] = STAR_COLOURS[cls];
  return palette.index(ramp, tones[tone]);
}

const SPACE = palette.index('space', 0);

/**
 * Dithered glow of the galaxy's density: warm light around the core, the nebula colours of the
 * region in young arms, grey-blue dust elsewhere.
 */
function glow(info: Pick<SectorInfo, 'nebula' | 'nebulaRamp'>, density: number, x: number, y: number): number {
  const level = ditherQuantize(Math.sqrt(density) * 3.4, bayerThreshold(BAYER4, x, y), 0.9);
  if (level <= 0) return SPACE;
  if (info.nebulaRamp === 'gas-warm') return palette.index('gas-warm', Math.min(3, level - 1));
  if (info.nebula > 0.3) return palette.index(info.nebulaRamp, Math.min(2, level - 1));
  return palette.index('space', Math.min(3, level));
}

/** Classes bright enough to show on the whole-galaxy map even in a sparse sector. */
const BEACONS = new Set(['O', 'B', 'A', 'red-giant']);

/** Brightest star of every system of a sector, and the class that wins. */
function brightest(info: SectorInfo): string | null {
  let best: string | null = null;
  let lum = -1;
  for (let i = 0; i < info.count; i++) {
    const star = systemSummary(info, i).stars[0];
    if (star.luminosity > lum) {
      lum = star.luminosity;
      best = star.class;
    }
  }
  return best;
}

export interface GalaxyMap {
  readonly buffer: IndexedBuffer;
  /** Sector at the top-left pixel. */
  readonly origin: readonly [number, number];
  readonly systems: number;
}

/**
 * The whole galaxy, one pixel per sector: colour from the brightest star of the sector,
 * brightness from its number of systems, and a dithered glow of the density in between.
 */
export function galaxyMap(galaxy: Galaxy, extent = Math.ceil(galaxy.shape.radius * 1.15)): GalaxyMap {
  const side = 2 * extent;
  const buffer = new IndexedBuffer(side, side).fill(SPACE);
  let systems = 0;
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const info = galaxy.sector(x - extent, y - extent);
      systems += info.count;
      const cls = brightest(info);
      if (cls === null || (info.count < 4 && !BEACONS.has(cls))) {
        buffer.set(x, y, glow(info, info.density, x, y));
        continue;
      }
      const tone = info.count <= 4 ? 0 : info.count <= 9 ? 1 : 2;
      buffer.set(x, y, starColour(cls, tone));
    }
  }
  return { buffer, origin: [-extent, -extent], systems };
}

export interface RegionOptions {
  /** Centre sector. */
  readonly cx: number;
  readonly cy: number;
  /** Sectors from the centre to the edge. */
  readonly radius: number;
  /** Pixels per sector. */
  readonly cell: number;
}

/** Draws a system as a dot: bigger and with a cross for bright stars, a pair for binaries. */
function drawSystem(buf: IndexedBuffer, x: number, y: number, stars: readonly { class: string; luminosity: number }[]): void {
  const main = stars[0];
  const bright = main.luminosity >= 5 || main.class === 'red-giant';
  if (bright) {
    const dim = starColour(main.class, 0);
    buf.set(x - 1, y, dim);
    buf.set(x + 1, y, dim);
    buf.set(x, y - 1, dim);
    buf.set(x, y + 1, dim);
  }
  buf.set(x, y, starColour(main.class, main.luminosity >= 0.5 ? 2 : 1));
  if (stars.length > 1) buf.set(x + (bright ? 2 : 1), y + (bright ? 0 : 1), starColour(stars[1].class, 1));
}

/** A region around a sector: glow of the density at sub-sector resolution and every system. */
export function regionMap(galaxy: Galaxy, o: RegionOptions): GalaxyMap {
  const n = 2 * o.radius + 1;
  const side = n * o.cell;
  const buffer = new IndexedBuffer(side, side).fill(SPACE);
  const x0 = o.cx - o.radius;
  const y0 = o.cy - o.radius;
  const infos: SectorInfo[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) infos.push(galaxy.sector(x0 + i, y0 + j));

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const c = galaxy.character(x0 + (x + 0.5) / o.cell, y0 + (y + 0.5) / o.cell);
      // Ramp borders dithered too, so colours blend instead of stepping.
      const t = bayerThreshold(BAYER4, x, y) - 0.5;
      const [nebulaRamp] = nebulaRamps(c.core + t * 0.15, c.hue + t * 0.12);
      buffer.set(x, y, glow({ nebula: c.nebula + t * 0.15, nebulaRamp }, c.density * 0.6, x, y));
    }
  }
  // Sector corners, so distances can be read off the map.
  const mark = palette.index('ui-cool', 1);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) buffer.set(i * o.cell - (i === n ? 1 : 0), j * o.cell - (j === n ? 1 : 0), mark);

  let systems = 0;
  for (const info of infos) {
    for (let k = 0; k < info.count; k++) {
      const s = systemSummary(info, k);
      const px = Math.floor((s.position.sx - x0 + s.position.x) * o.cell);
      const py = Math.floor((s.position.sy - y0 + s.position.y) * o.cell);
      drawSystem(buffer, px, py, s.stars);
      systems++;
    }
  }
  return { buffer, origin: [x0, y0], systems };
}
