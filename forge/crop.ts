// Temporary helper: crop a PNG and upscale it for close inspection.
// npx tsx forge/crop.ts <in.png> <x> <y> <w> <h> <scale> <out.png>
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { writePng } from './png';

const [src, xs, ys, ws, hs, ss, dst] = process.argv.slice(2);
const png = PNG.sync.read(readFileSync(src));
const [x0, y0, w, h, scale] = [xs, ys, ws, hs, ss].map(Number);
const out = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const s = ((y0 + y) * png.width + x0 + x) * 4;
    out.set(png.data.subarray(s, s + 4), (y * w + x) * 4);
  }
}
writePng(dst, out, w, h, scale);
