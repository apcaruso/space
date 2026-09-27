// Drawing primitives on indexed buffers: lines, circles, discs, rectangles, masked blits and
// index-table fills. Everything the explorer draws that is not a generator sprite.

import { IndexedBuffer, TRANSPARENT } from '../core/buffer';
import { BAYER4, bayerThreshold } from '../toolkit/dither';
import type { IndexTable } from '../toolkit/palette';

/** Bresenham line; `dotted` 1 keeps every other pixel, 2 one in four (anchored to the screen). */
export function line(buf: IndexedBuffer, x0: number, y0: number, x1: number, y1: number, index: number, dotted = 0): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  const mask = dotted === 0 ? 0 : dotted === 1 ? 1 : 3;
  for (;;) {
    if (((x + y) & mask) === 0) buf.set(x, y, index);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

export function rect(buf: IndexedBuffer, x: number, y: number, w: number, h: number, index: number): void {
  for (let j = Math.max(0, y); j < Math.min(buf.h, y + h); j++) buf.data.fill(index, j * buf.w + Math.max(0, x), j * buf.w + Math.min(buf.w, x + w));
}

export function frame(buf: IndexedBuffer, x: number, y: number, w: number, h: number, index: number): void {
  rect(buf, x, y, w, 1, index);
  rect(buf, x, y + h - 1, w, 1, index);
  rect(buf, x, y, 1, h, index);
  rect(buf, x + w - 1, y, 1, h, index);
}

/** Applies an index table to a rectangle: darkening glass behind panels, highlights... */
export function tint(buf: IndexedBuffer, x: number, y: number, w: number, h: number, table: IndexTable): void {
  for (let j = Math.max(0, y); j < Math.min(buf.h, y + h); j++) {
    for (let i = Math.max(0, x); i < Math.min(buf.w, x + w); i++) {
      const k = j * buf.w + i;
      buf.data[k] = table[buf.data[k]];
    }
  }
}

/** Filled disc of radius r (pixels) centred on (cx, cy), pixel centres inside. */
export function disc(buf: IndexedBuffer, cx: number, cy: number, r: number, index: number): void {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) buf.set(x, y, index);
    }
  }
}

/** Circle outline (midpoint algorithm); `dotted` skips every other pixel. */
export function circle(buf: IndexedBuffer, cx: number, cy: number, r: number, index: number, dotted = false): void {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  let x = Math.round(r);
  let y = 0;
  let err = 1 - x;
  let n = 0;
  while (x >= y) {
    if (!dotted || (n & 1) === 0) {
      buf.set(x0 + x, y0 + y, index);
      buf.set(x0 + y, y0 + x, index);
      buf.set(x0 - y, y0 + x, index);
      buf.set(x0 - x, y0 + y, index);
      buf.set(x0 - x, y0 - y, index);
      buf.set(x0 - y, y0 - x, index);
      buf.set(x0 + y, y0 - x, index);
      buf.set(x0 + x, y0 - y, index);
    }
    n++;
    y++;
    if (err < 0) err += 2 * y + 1;
    else {
      x--;
      err += 2 * (y - x) + 1;
    }
  }
}

/**
 * Copies the opaque pixels of `src` with its top-left at (dx, dy). With `mask` (0..1) only the
 * pixels whose Bayer threshold is below it are copied (above it with `invert`): two masked blits
 * make a dithered dissolve.
 */
export function blit(dst: IndexedBuffer, src: IndexedBuffer, dx: number, dy: number, mask = 1, invert = false): void {
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const x1 = Math.min(src.w, dst.w - dx);
  const y1 = Math.min(src.h, dst.h - dy);
  const full = mask >= 1 && !invert;
  for (let y = y0; y < y1; y++) {
    const srow = y * src.w;
    const drow = (y + dy) * dst.w + dx;
    for (let x = x0; x < x1; x++) {
      const v = src.data[srow + x];
      if (v === TRANSPARENT) continue;
      if (!full) {
        const t = bayerThreshold(BAYER4, x + dx, y + dy);
        if (invert ? t < mask : t >= mask) continue;
      }
      dst.data[drow + x] = v;
    }
  }
}

/** Is pixel (x, y) kept at a dithered opacity `alpha`? */
export function keep(x: number, y: number, alpha: number): boolean {
  return alpha >= 1 || bayerThreshold(BAYER4, x, y) < alpha;
}
