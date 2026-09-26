// Selective outlines: the line takes the darkest tone of the material it borders, not black.

import { IndexedBuffer, TRANSPARENT } from '../core/buffer';
import type { Palette } from './palette';

export interface OutlineOptions {
  /** Also outline pixels that touch the sprite only diagonally (heavier corners). Default false. */
  diagonal?: boolean;
  /**
   * Also draw lines inside the sprite where unrelated ramps meet. The line goes on the lighter
   * side, in that material's darkest tone. Ramps that share a colour count as related, so
   * shading inside one material never produces lines. Default false.
   */
  inner?: boolean;
  /** Ramps that never produce or receive outline pixels (emissive glow, effects). */
  skip?: readonly string[];
}

// (dx, dy) pairs: the four orthogonal neighbours, then the four diagonal ones.
const NEIGHBOURS = [0, -1, -1, 0, 1, 0, 0, 1, -1, -1, 1, -1, -1, 1, 1, 1];

/**
 * Returns a new buffer with a 1 px outline around the opaque pixels. Each outline pixel takes
 * the darkest tone of the adjacent pixel's home ramp; where several materials touch it, the
 * darkest of their outline colours wins. The buffer needs a transparent margin: the outline
 * does not grow the canvas.
 */
export function outline(buf: IndexedBuffer, palette: Palette, opts: OutlineOptions = {}): IndexedBuffer {
  const { w, h } = buf;
  const src = buf.data;
  const out = new IndexedBuffer(w, h, src.slice());
  const skip = new Uint8Array(palette.ramps.length);
  for (const name of opts.skip ?? []) skip[palette.ramp(name).id] = 1;
  const count = opts.diagonal ? 16 : 8;

  // Outline colour for each index (0 where the index takes part in no outline).
  const lineOf = new Uint8Array(256);
  for (let i = 1; i < palette.size; i++) {
    const ramp = palette.homeRamp(i);
    if (ramp !== undefined && skip[ramp.id] === 0) lineOf[i] = palette.darkest(ramp);
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = src[i];
      if (c === TRANSPARENT) {
        let best = TRANSPARENT;
        let bestL = Infinity;
        for (let k = 0; k < count; k += 2) {
          const nx = x + NEIGHBOURS[k];
          const ny = y + NEIGHBOURS[k + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const line = lineOf[src[ny * w + nx]];
          if (line === TRANSPARENT) continue;
          const L = palette.lightnessOf(line);
          if (L < bestL || (L === bestL && line < best)) {
            best = line;
            bestL = L;
          }
        }
        if (best !== TRANSPARENT) out.data[i] = best;
      } else if (opts.inner && lineOf[c] !== TRANSPARENT) {
        const Lc = palette.lightnessOf(c);
        for (let k = 0; k < 8; k += 2) {
          const nx = x + NEIGHBOURS[k];
          const ny = y + NEIGHBOURS[k + 1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = src[ny * w + nx];
          if (q === TRANSPARENT || palette.related(c, q)) continue;
          const Lq = palette.lightnessOf(q);
          if (Lc > Lq || (Lc === Lq && c > q)) {
            out.data[i] = lineOf[c];
            break;
          }
        }
      }
    }
  }
  return out;
}
