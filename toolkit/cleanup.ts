// Pixel clean-up passes. Each returns a new buffer.
//
// Run removeOrphans on material maps or undithered images: on dithered output it would erase
// the sparse dither pixels, which are orphans by design.

import { IndexedBuffer, TRANSPARENT } from '../core/buffer';

// (dx, dy) of the 8 neighbours; the orthogonal ones are at positions 1 (up), 3 (left),
// 4 (right) and 6 (down).
const N8 = [-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1];

const scratch = new Int16Array(8);

/** Reads the 8 neighbours of (x, y) into `scratch`; outside the buffer counts as transparent. */
function neighbours(buf: IndexedBuffer, x: number, y: number): void {
  for (let k = 0; k < 8; k++) {
    const nx = x + N8[2 * k];
    const ny = y + N8[2 * k + 1];
    scratch[k] = nx < 0 || ny < 0 || nx >= buf.w || ny >= buf.h ? TRANSPARENT : buf.data[ny * buf.w + nx];
  }
}

/** Is `v` part of the same line as a pixel of index `c`? */
function onLine(v: number, c: number, isLine: Uint8Array | null): boolean {
  return isLine === null ? v === c : isLine[v] === 1;
}

const ANY = 0;
const OPAQUE = 1;
const OFF_LINE = 2;

/**
 * Most frequent value in `scratch` among those passing `filter`. Ties go to the lowest index,
 * except that transparency loses ties when `opaqueWins`. Returns -1 if nothing passes.
 */
function mode(filter: number, opaqueWins: boolean, c = 0, isLine: Uint8Array | null = null): number {
  let best = -1;
  let bestCount = 0;
  for (let i = 0; i < 8; i++) {
    const v = scratch[i];
    if (filter === OPAQUE && v === TRANSPARENT) continue;
    if (filter === OFF_LINE && onLine(v, c, isLine)) continue;
    let count = 0;
    for (let j = 0; j < 8; j++) if (scratch[j] === v) count++;
    const rank = opaqueWins && v === TRANSPARENT ? 256 : v;
    const bestRank = opaqueWins && best === TRANSPARENT ? 256 : best;
    if (count > bestCount || (count === bestCount && rank < bestRank)) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Replaces every opaque pixel that shares its index with none of its 8 neighbours by the most
 * common neighbour value (opaque values win ties). An isolated pixel on a transparent
 * background disappears.
 */
export function removeOrphans(buf: IndexedBuffer): IndexedBuffer {
  const out = new IndexedBuffer(buf.w, buf.h, buf.data.slice());
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const c = buf.data[y * buf.w + x];
      if (c === TRANSPARENT) continue;
      neighbours(buf, x, y);
      let alone = true;
      for (let k = 0; k < 8; k++) if (scratch[k] === c) alone = false;
      if (alone) out.data[y * buf.w + x] = mode(ANY, true);
    }
  }
  return out;
}

/** Fills transparent pixels whose 4 orthogonal neighbours are all opaque with the most common opaque neighbour. */
export function fillHoles(buf: IndexedBuffer): IndexedBuffer {
  const out = new IndexedBuffer(buf.w, buf.h, buf.data.slice());
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      if (buf.data[y * buf.w + x] !== TRANSPARENT) continue;
      neighbours(buf, x, y);
      if (scratch[1] === TRANSPARENT || scratch[3] === TRANSPARENT || scratch[4] === TRANSPARENT || scratch[6] === TRANSPARENT) continue;
      out.data[y * buf.w + x] = mode(OPAQUE, false);
    }
  }
  return out;
}

/**
 * Pixel-perfect lines: removes the corner pixel of L-shaped steps in 1 px lines, so a jagged
 * staircase becomes a clean diagonal. A pixel is removed when it has exactly one horizontal and
 * one vertical line neighbour, both diagonal corners on the L's axis are free (so 2x2 blocks
 * stay and the line stays connected), and at least one arm is a single-pixel step (so true
 * corners, like those of a rectangle, stay). By default a line is a run of one index; pass
 * `lineIndices` to treat several indices as one line (for example all outline colours).
 * Pixels are processed in scan order, each seeing earlier removals; a removed pixel takes the
 * most common non-line neighbour (transparency wins ties).
 */
export function fixCorners(buf: IndexedBuffer, lineIndices?: readonly number[]): IndexedBuffer {
  const out = new IndexedBuffer(buf.w, buf.h, buf.data.slice());
  let isLine: Uint8Array | null = null;
  if (lineIndices !== undefined) {
    isLine = new Uint8Array(256);
    for (const i of lineIndices) isLine[i] = 1;
  }
  const { w, h } = out;
  const at = (x: number, y: number, c: number) =>
    x >= 0 && y >= 0 && x < w && y < h && out.data[y * w + x] !== TRANSPARENT && onLine(out.data[y * w + x], c, isLine);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = out.data[y * w + x];
      if (c === TRANSPARENT || (isLine !== null && isLine[c] === 0)) continue;
      const left = at(x - 1, y, c);
      const right = at(x + 1, y, c);
      const up = at(x, y - 1, c);
      const down = at(x, y + 1, c);
      if (left === right || up === down) continue;
      const ax = left ? -1 : 1;
      const by = up ? -1 : 1;
      if (at(x + ax, y + by, c) || at(x - ax, y - by, c)) continue;
      if (at(x + 2 * ax, y, c) && at(x, y + 2 * by, c)) continue;
      neighbours(out, x, y);
      out.data[y * w + x] = mode(OFF_LINE, false, c, isLine);
    }
  }
  return out;
}
