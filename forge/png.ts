import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

export interface PngOptions {
  /** Integer upscale, nearest neighbour. Default 1. */
  scale?: number;
  /** Darken the first row and column of every upscaled pixel, to count pixels. */
  grid?: boolean;
}

/** Encodes RGBA pixels as PNG bytes. */
export function encodePng(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, opts: PngOptions = {}): Uint8Array {
  const scale = opts.scale ?? 1;
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`scale must be a positive integer, got ${scale}`);
  const grid = (opts.grid ?? false) && scale >= 3;
  const W = w * scale;
  const png = new PNG({ width: W, height: h * scale });
  for (let y = 0; y < h * scale; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const s = (sy * w + Math.floor(x / scale)) * 4;
      const d = (y * W + x) * 4;
      if (grid && (x % scale === 0 || y % scale === 0)) {
        // Transparent pixels get a faint dark line, opaque ones are darkened.
        const opaque = rgba[s + 3] !== 0;
        png.data[d] = opaque ? Math.round(rgba[s] * 0.6) : 0;
        png.data[d + 1] = opaque ? Math.round(rgba[s + 1] * 0.6) : 0;
        png.data[d + 2] = opaque ? Math.round(rgba[s + 2] * 0.6) : 0;
        png.data[d + 3] = opaque ? rgba[s + 3] : 64;
      } else {
        png.data[d] = rgba[s];
        png.data[d + 1] = rgba[s + 1];
        png.data[d + 2] = rgba[s + 2];
        png.data[d + 3] = rgba[s + 3];
      }
    }
  }
  return PNG.sync.write(png);
}

/** Writes RGBA pixels as a PNG file, creating folders as needed. */
export function writePng(path: string, rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, opts: PngOptions | number = {}): void {
  const o = typeof opts === 'number' ? { scale: opts } : opts;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(rgba, w, h, o));
}
