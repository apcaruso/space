import { createRequire } from 'node:module';
import type * as Gifenc from 'gifenc';
import { IndexedBuffer } from '../core/buffer';
import type { Palette } from '../toolkit/palette';

// gifenc ships CommonJS for Node and ESM for bundlers, with different exports; forge only runs
// in Node, so always load the CommonJS build (same code under tsx and Vitest).
const { GIFEncoder } = createRequire(import.meta.url)('gifenc') as typeof Gifenc;

/** Nearest-neighbour integer upscale of an indexed buffer. */
export function upscale(buf: IndexedBuffer, scale: number): IndexedBuffer {
  if (scale === 1) return buf;
  const out = new IndexedBuffer(buf.w * scale, buf.h * scale);
  for (let y = 0; y < out.h; y++) {
    const row = Math.floor(y / scale) * buf.w;
    for (let x = 0; x < out.w; x++) out.data[y * out.w + x] = buf.data[row + Math.floor(x / scale)];
  }
  return out;
}

/**
 * Encodes indexed frames as a looping GIF that uses the palette directly (no quantisation).
 * Index 0 is transparent; frames are cleared between each other, so nothing ghosts.
 */
export function encodeGif(frames: readonly IndexedBuffer[], palette: Palette, fps: number, scale: number): Uint8Array {
  if (frames.length === 0) throw new RangeError('encodeGif: no frames');
  const rgba = palette.toRGBA(new IndexedBuffer(palette.size, 1, Uint8Array.from({ length: palette.size }, (_, i) => i)));
  // GIF colour tables have a power-of-two size.
  let tableSize = 2;
  while (tableSize < palette.size) tableSize *= 2;
  const table: number[][] = [];
  for (let i = 0; i < tableSize; i++) table.push(i < palette.size ? [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] : [0, 0, 0]);
  const delay = Math.round(1000 / fps);
  const gif = GIFEncoder();
  frames.forEach((frame, i) => {
    const big = upscale(frame, scale);
    gif.writeFrame(big.data, big.w, big.h, {
      palette: i === 0 ? table : undefined,
      transparent: true,
      transparentIndex: 0,
      delay,
      repeat: 0,
    });
  });
  gif.finish();
  return gif.bytes();
}
