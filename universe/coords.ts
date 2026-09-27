// Galactic coordinates: an integer sector plus a float offset inside it, so precision depends on
// the distance between two points, never on their distance from the galactic centre.

export interface SectorCoord {
  readonly sx: number;
  readonly sy: number;
}

/** A point of the galaxy: integer sector (int32) and offset x, y in [0, 1) within it. */
export interface GalacticPoint extends SectorCoord {
  readonly x: number;
  readonly y: number;
}

/** Moves offsets outside [0, 1) into the right sector. */
export function normalize(sx: number, sy: number, x: number, y: number): GalacticPoint {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  return { sx: sx + fx, sy: sy + fy, x: x - fx, y: y - fy };
}

/** Global float position in sector units. Fine for drawing the galaxy (|sector| < 2^20). */
export function toGlobal(p: GalacticPoint): [number, number] {
  return [p.sx + p.x, p.sy + p.y];
}

export function fromGlobal(gx: number, gy: number): GalacticPoint {
  return normalize(0, 0, gx, gy);
}

/**
 * Vector from a to b in sector units. Integer parts are subtracted first, so the result is as
 * precise as the distance between the points allows: this is the conversion for cameras.
 */
export function delta(a: GalacticPoint, b: GalacticPoint): [number, number] {
  return [b.sx - a.sx + (b.x - a.x), b.sy - a.sy + (b.y - a.y)];
}
