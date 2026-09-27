// Presentation: indexed framebuffer to 32-bit pixels through a palette table, the only place
// where colours become RGBA. Global colour effects (palette cycling, fades) change the table,
// not the pixels, so they cost nothing per pixel.

import type { IndexedBuffer } from '../core/buffer';
import type { IndexTable, Palette } from '../toolkit/palette';

/** Palette as little-endian 0xAABBGGRR words (the layout of ImageData on every target). */
export function paletteWords(palette: Palette, table?: IndexTable): Uint32Array {
  const rgba = palette.toRGBA({ w: palette.size, h: 1, data: Uint8Array.from({ length: palette.size }, (_, i) => i) } as IndexedBuffer);
  const words = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const src = table === undefined ? i : table[i];
    if (src >= palette.size) continue;
    const o = src * 4;
    words[i] = ((255 << 24) | (rgba[o + 2] << 16) | (rgba[o + 1] << 8) | rgba[o]) >>> 0;
  }
  return words;
}

/** Fills `out` (one word per pixel) from the framebuffer through the palette words. */
export function present(fb: IndexedBuffer, words: Uint32Array, out: Uint32Array): void {
  const src = fb.data;
  for (let i = 0; i < src.length; i++) out[i] = words[src[i]];
}
