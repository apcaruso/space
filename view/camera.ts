// Camera: a centre in galactic coordinates and a zoom z = log2(pixels per sector). Everything in
// the world has a continuous position in sector units; the projection anchors pixels to the
// world, so while panning every object moves by the same whole number of pixels.

import { exp, LN2 } from '../core/dmath';
import { normalize, type GalacticPoint } from '../universe/coords';

export const SCREEN_W = 480;
export const SCREEN_H = 270;

/** Whole galaxy in view; a moon filling the screen. */
export const Z_MIN = -1.6;
export const Z_MAX = 21;

export interface Camera {
  readonly center: GalacticPoint;
  readonly z: number;
}

export function zoomScale(z: number): number {
  return exp(z * LN2);
}

export function clampZ(z: number): number {
  return Math.min(Z_MAX, Math.max(Z_MIN, z));
}

/** Projection of one frame: world (sector units) to screen pixels and back. */
export class Projection {
  readonly camera: Camera;
  /** Pixels per sector. */
  readonly s: number;
  /** Fractional pixel of the camera centre in the world-anchored pixel grid. */
  private readonly frac: number;
  private readonly fracY: number;

  constructor(camera: Camera) {
    this.camera = camera;
    this.s = zoomScale(camera.z);
    const c = camera.center;
    const px = c.sx * this.s + c.x * this.s;
    const py = c.sy * this.s + c.y * this.s;
    this.frac = px - Math.floor(px);
    this.fracY = py - Math.floor(py);
  }

  /** Screen x of a world point given as sector + offset + extra offset (all in sectors). */
  x(sx: number, x: number, dx = 0): number {
    const c = this.camera.center;
    return (sx - c.sx) * this.s + (x - c.x + dx) * this.s + this.frac + SCREEN_W / 2;
  }

  y(sy: number, y: number, dy = 0): number {
    const c = this.camera.center;
    return (sy - c.sy) * this.s + (y - c.y + dy) * this.s + this.fracY + SCREEN_H / 2;
  }

  /** Pixel column / row of a world point (floor of x / y): stable under panning. */
  px(sx: number, x: number, dx = 0): number {
    return Math.floor(this.x(sx, x, dx));
  }

  py(sy: number, y: number, dy = 0): number {
    return Math.floor(this.y(sy, y, dy));
  }

  /** World point at the centre of screen pixel (X, Y). */
  toWorld(X: number, Y: number): GalacticPoint {
    const c = this.camera.center;
    return normalize(c.sx, c.sy, c.x + (X + 0.5 - SCREEN_W / 2 - this.frac) / this.s, c.y + (Y + 0.5 - SCREEN_H / 2 - this.fracY) / this.s);
  }

  /** Visible world rectangle in global sector units, with a margin in pixels. */
  bounds(marginPx = 0): { x0: number; y0: number; x1: number; y1: number } {
    const c = this.camera.center;
    const hw = (SCREEN_W / 2 + marginPx) / this.s;
    const hh = (SCREEN_H / 2 + marginPx) / this.s;
    return { x0: c.sx + c.x - hw, y0: c.sy + c.y - hh, x1: c.sx + c.x + hw, y1: c.sy + c.y + hh };
  }
}

/** Moves the camera by a number of screen pixels (drag right = world moves right). */
export function pan(camera: Camera, dxPx: number, dyPx: number): Camera {
  const s = zoomScale(camera.z);
  const c = camera.center;
  return { center: normalize(c.sx, c.sy, c.x - dxPx / s, c.y - dyPx / s), z: camera.z };
}

/** Zooms by dz keeping the world point under screen pixel (X, Y) where it is. */
export function zoomAt(camera: Camera, X: number, Y: number, dz: number): Camera {
  const z = clampZ(camera.z + dz);
  if (z === camera.z) return camera;
  const before = new Projection(camera).toWorld(X, Y);
  const s = zoomScale(z);
  const ox = (X + 0.5 - SCREEN_W / 2) / s;
  const oy = (Y + 0.5 - SCREEN_H / 2) / s;
  return { center: normalize(before.sx, before.sy, before.x - ox, before.y - oy), z };
}

/** Camera centred on a point. */
export function lookAt(p: GalacticPoint, z: number, dx = 0, dy = 0): Camera {
  return { center: normalize(p.sx, p.sy, p.x + dx, p.y + dy), z: clampZ(z) };
}
