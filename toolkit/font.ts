// 3x5 bitmap font for labels on preview sheets. The one hand-made graphic in the project:
// each glyph is five rows of three bits, top to bottom, 1 = ink.

import type { IndexedBuffer } from '../core/buffer';

export const GLYPH_W = 3;
export const GLYPH_H = 5;
/** Horizontal distance between glyph origins (one column of spacing). */
export const ADVANCE = 4;
/** Vertical distance between lines. */
export const LINE_HEIGHT = 6;

const SOURCE: readonly (readonly [string, string])[] = [
  ['0', '111 101 101 101 111'],
  ['1', '010 110 010 010 111'],
  ['2', '111 001 111 100 111'],
  ['3', '111 001 011 001 111'],
  ['4', '101 101 111 001 001'],
  ['5', '111 100 111 001 111'],
  ['6', '111 100 111 101 111'],
  ['7', '111 001 001 010 010'],
  ['8', '111 101 111 101 111'],
  ['9', '111 101 111 001 111'],
  ['A', '010 101 111 101 101'],
  ['B', '110 101 110 101 110'],
  ['C', '011 100 100 100 011'],
  ['D', '110 101 101 101 110'],
  ['E', '111 100 110 100 111'],
  ['F', '111 100 110 100 100'],
  ['G', '011 100 101 101 011'],
  ['H', '101 101 111 101 101'],
  ['I', '111 010 010 010 111'],
  ['J', '001 001 001 101 010'],
  ['K', '101 101 110 101 101'],
  ['L', '100 100 100 100 111'],
  ['M', '111 111 101 101 101'],
  ['N', '110 101 101 101 101'],
  ['O', '010 101 101 101 010'],
  ['P', '110 101 110 100 100'],
  ['Q', '010 101 101 111 011'],
  ['R', '110 101 110 101 101'],
  ['S', '011 100 010 001 110'],
  ['T', '111 010 010 010 010'],
  ['U', '101 101 101 101 111'],
  ['V', '101 101 101 010 010'],
  ['W', '101 101 111 111 101'],
  ['X', '101 101 010 101 101'],
  ['Y', '101 101 010 010 010'],
  ['Z', '111 001 010 100 111'],
  [' ', '000 000 000 000 000'],
  ['.', '000 000 000 000 010'],
  [',', '000 000 000 010 100'],
  [':', '000 010 000 010 000'],
  [';', '000 010 000 010 100'],
  ['-', '000 000 111 000 000'],
  ['+', '000 010 111 010 000'],
  ['=', '000 111 000 111 000'],
  ['_', '000 000 000 000 111'],
  ['/', '001 001 010 100 100'],
  ['(', '001 010 010 010 001'],
  [')', '100 010 010 010 100'],
  ['!', '010 010 010 000 010'],
  ['?', '111 001 010 000 010'],
  ["'", '010 010 000 000 000'],
  ['#', '101 111 101 111 101'],
  ['%', '101 001 010 100 101'],
  ['*', '000 101 010 101 000'],
  ['<', '001 010 100 010 001'],
  ['>', '100 010 001 010 100'],
];

/** Glyph bitmaps: bit 14 is the top-left pixel, bit 0 the bottom-right. */
const GLYPHS = new Map<string, number>(SOURCE.map(([ch, rows]) => [ch, parseInt(rows.replaceAll(' ', ''), 2)]));

/** Characters the font can draw; lowercase letters are drawn as uppercase, anything else as '?'. */
export const CHARSET = SOURCE.map(([ch]) => ch).join('');

function glyph(ch: string): number {
  return GLYPHS.get(ch.toUpperCase()) ?? (GLYPHS.get('?') as number);
}

/** Width in pixels of a single line of text. */
export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * ADVANCE - 1;
}

/** Draws one line of text with its top-left corner at (x, y), clipped to the buffer. */
export function drawText(buf: IndexedBuffer, text: string, x: number, y: number, index: number): void {
  for (let i = 0; i < text.length; i++) {
    const bits = glyph(text[i]);
    const ox = x + i * ADVANCE;
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) {
        if ((bits >> (14 - (row * GLYPH_W + col))) & 1) buf.set(ox + col, y + row, index);
      }
    }
  }
}
