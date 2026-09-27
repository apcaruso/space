// Where things are: world position of an address at a tick, the zoom that frames it at each
// level, and the address of the object under a point of view.

import { LN2, log } from '../core/dmath';
import type { Address, BodyRef } from '../universe/address';
import { normalize, type GalacticPoint } from '../universe/coords';
import type { Galaxy } from '../universe/galaxy';
import { catalogueExtent } from './catalogue';
import { SCREEN_H, clampZ } from './camera';
import { SYSTEM_RADIUS, type SystemGeometry } from './geometry';

export const LEVELS = ['galaxy', 'region', 'system', 'body', 'surface'] as const;
export type Level = (typeof LEVELS)[number];

/** Italian names of the levels, for the interface. */
export const LEVEL_NAMES: Readonly<Record<Level, string>> = {
  galaxy: 'galassia',
  region: 'regione',
  system: 'sistema',
  body: 'corpo',
  surface: 'superficie',
};

const log2 = (x: number) => log(x) / LN2;

/** Offset of a body from its system's position, in sectors. */
export function bodyOffset(g: SystemGeometry, body: BodyRef, tick: number): { dx: number; dy: number } {
  switch (body.kind) {
    case 'star':
      return g.star(body.index, tick);
    case 'belt': {
      const b = g.belts[body.index];
      return { dx: (b.inner + b.outer) / 2, dy: 0 };
    }
    case 'comet':
      return g.comet(body.index, tick);
    default: {
      const p = g.planet(body.index, tick);
      if (body.moon === undefined) return p;
      const m = g.moon(body.index, body.moon, tick);
      return { dx: p.dx + m.dx, dy: p.dy + m.dy };
    }
  }
}

/** Radius on screen, in sectors, of the thing an address names (for framing it). */
export function bodyRadius(g: SystemGeometry, body: BodyRef): number {
  switch (body.kind) {
    case 'star':
      return g.starRadius[body.index];
    case 'belt':
      return g.belts[body.index].outer;
    case 'comet':
      return 0.00035;
    default:
      return body.moon === undefined ? g.planetRadius[body.index] : g.moonRadius[body.index][body.moon];
  }
}

export interface Place {
  readonly point: GalacticPoint;
  /** Zoom of each level when looking at this place. */
  readonly zoom: Readonly<Record<Level, number>>;
}

/**
 * Position of an address at `tick` and the zoom of each level around it. `geometry` resolves
 * systems (the explorer caches them).
 */
export function place(galaxy: Galaxy, address: Address, tick: number, geometry: (sx: number, sy: number, i: number) => SystemGeometry): Place {
  const galaxyZ = log2(SCREEN_H / (2 * catalogueExtent(galaxy) * 0.9));
  const zoom = { galaxy: galaxyZ, region: 4.6, system: 12, body: 16, surface: 18 };
  if (address.sector === undefined) return { point: { sx: 0, sy: 0, x: 0, y: 0 }, zoom };
  const { sx, sy } = address.sector;
  if (address.system === undefined) return { point: { sx, sy, x: 0.5, y: 0.5 }, zoom: { ...zoom, region: 7.5 } };
  const g = geometry(sx, sy, address.system);
  const pos = g.system.position;
  // The system fills the screen height at the system level.
  zoom.system = log2((SCREEN_H * 0.45) / g.extent);
  zoom.region = Math.min(zoom.region, zoom.system - 6);
  if (address.body === undefined) return { point: pos, zoom: { ...zoom, body: zoom.system + 3, surface: zoom.system + 5 } };
  const o = bodyOffset(g, address.body, tick);
  const r = bodyRadius(g, address.body);
  zoom.body = clampZ(log2(110 / (2 * r)));
  zoom.surface = clampZ(log2(380 / (2 * r)));
  if (address.body.kind === 'belt') zoom.body = zoom.system + 1;
  return { point: normalize(pos.sx, pos.sy, pos.x + o.dx, pos.y + o.dy), zoom };
}

/** The level a zoom belongs to, around a place. */
export function levelAt(p: Place, z: number): Level {
  if (z >= p.zoom.surface - 0.3) return 'surface';
  if (z >= p.zoom.body - 1.5) return 'body';
  if (z >= p.zoom.system - 2.5) return 'system';
  if (z >= Math.min(p.zoom.region, p.zoom.galaxy + 3)) return 'region';
  return 'galaxy';
}

export { SYSTEM_RADIUS };
