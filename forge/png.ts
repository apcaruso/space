import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { PNG } from 'pngjs';

/** Writes RGBA pixels as a PNG, upscaled by an integer factor (nearest neighbour). */
export function writePng(path: string, rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, scale = 1): void {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError(`writePng: scale must be a positive integer, got ${scale}`);
  const png = new PNG({ width: w * scale, height: h * scale });
  const W = w * scale;
  for (let y = 0; y < h * scale; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const s = (sy * w + Math.floor(x / scale)) * 4;
      const d = (y * W + x) * 4;
      png.data[d] = rgba[s];
      png.data[d + 1] = rgba[s + 1];
      png.data[d + 2] = rgba[s + 2];
      png.data[d + 3] = rgba[s + 3];
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
}
