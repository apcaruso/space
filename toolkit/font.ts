// Bitmap fonts: 3x5 (labels, dense panels) and 5x7 (titles). The one hand-made graphic in the
// project: each glyph is a list of rows of bits, top to bottom, 1 = ink. Accented letters are
// not drawn by hand: they are the base letter plus an accent mark placed by code.

import type { IndexedBuffer } from '../core/buffer';

interface Glyph {
  /** Row of the first bitmap row relative to the top of a capital (accents on capitals: -1, -2). */
  readonly top: number;
  /** One bitmask per row; the leftmost column is the highest bit. */
  readonly rows: readonly number[];
}

export interface Font {
  readonly name: string;
  /** Glyph width and capital height. */
  readonly width: number;
  readonly height: number;
  /** Horizontal distance between glyph origins. */
  readonly advance: number;
  /** Vertical distance between lines, room for accents and descenders included. */
  readonly lineHeight: number;
  /** Lowercase drawn as capitals (labels of the preview sheets). */
  readonly caps: boolean;
  readonly glyphs: ReadonlyMap<string, Glyph>;
}

type Source = readonly (readonly [string, string, number?])[];

function parse(source: Source): Map<string, Glyph> {
  return new Map(
    source.map(([ch, rows, top]) => [ch, { top: top ?? 0, rows: rows.split(' ').map((r) => parseInt(r, 2)) }] as const),
  );
}

/**
 * Accented letters from their base: lowercase get the mark in the free rows above the x-height
 * (replacing the dot of i), capitals get it above the capital height.
 */
function accents(glyphs: Map<string, Glyph>, marks: { grave: readonly number[]; acute: readonly number[] }, lowerRows: number): void {
  const pairs: readonly (readonly [string, string, 'grave' | 'acute'])[] = [
    ['à', 'a', 'grave'], ['è', 'e', 'grave'], ['é', 'e', 'acute'], ['ì', 'i', 'grave'], ['í', 'i', 'acute'],
    ['ò', 'o', 'grave'], ['ó', 'o', 'acute'], ['ù', 'u', 'grave'], ['ú', 'u', 'acute']
  ];
  for (const [accented, base, kind] of pairs) {
    const mark = marks[kind];
    const lower = glyphs.get(base) as Glyph;
    const rows = [...lower.rows];
    for (let r = 0; r < lowerRows; r++) rows[r] = mark[r] ?? 0;
    glyphs.set(accented, { top: lower.top, rows });
    const upper = glyphs.get(base.toUpperCase()) as Glyph;
    glyphs.set(accented.toUpperCase(), { top: -mark.length, rows: [...mark, ...upper.rows] });
  }
}

const SMALL_SOURCE: Source = [
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
  // Lowercase: x-height rows 1-4, ascenders from row 0, descenders on row 5.
  ['a', '000 011 101 101 011'],
  ['b', '100 110 101 101 110'],
  ['c', '000 011 100 100 011'],
  ['d', '001 011 101 101 011'],
  ['e', '000 010 111 100 011'],
  ['f', '011 100 110 100 100'],
  ['g', '000 011 101 011 001 110'],
  ['h', '100 110 101 101 101'],
  ['i', '010 000 010 010 010'],
  ['j', '001 000 001 001 001 110'],
  ['k', '100 101 110 110 101'],
  ['l', '010 010 010 010 001'],
  ['m', '000 110 111 101 101'],
  ['n', '000 110 101 101 101'],
  ['o', '000 010 101 101 010'],
  ['p', '000 110 101 101 110 100'],
  ['q', '000 011 101 101 011 001'],
  ['r', '000 101 110 100 100'],
  ['s', '000 011 100 001 110'],
  ['t', '010 111 010 010 001'],
  ['u', '000 101 101 101 011'],
  ['v', '000 101 101 101 010'],
  ['w', '000 101 101 111 111'],
  ['x', '000 101 010 010 101'],
  ['y', '000 101 101 011 001 110'],
  ['z', '000 111 001 010 111'],
  [' ', '000'],
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
  ['[', '011 010 010 010 011'],
  [']', '110 010 010 010 110'],
  ['!', '010 010 010 000 010'],
  ['?', '111 001 010 000 010'],
  ["'", '010 010 000 000 000'],
  ['"', '101 101 000 000 000'],
  ['#', '101 111 101 111 101'],
  ['%', '101 001 010 100 101'],
  ['*', '000 101 010 101 000'],
  ['<', '001 010 100 010 001'],
  ['>', '100 010 001 010 100'],
  ['@', '010 101 111 100 011'],
  ['|', '010 010 010 010 010'],
  ['&', '010 101 010 101 011'],
  ['·', '000 000 010 000 000'],
  ['×', '000 000 101 010 101'],
  ['°', '010 101 010 000 000'],
  ['›', '000 100 010 100 000'],
  ['^', '010 101 000 000 000'],
  ['~', '000 011 110 000 000'],
];

const LARGE_SOURCE: Source = [
  ['0', '01110 10001 10011 10101 11001 10001 01110'],
  ['1', '00100 01100 00100 00100 00100 00100 01110'],
  ['2', '01110 10001 00001 00010 00100 01000 11111'],
  ['3', '11111 00010 00100 00010 00001 10001 01110'],
  ['4', '00010 00110 01010 10010 11111 00010 00010'],
  ['5', '11111 10000 11110 00001 00001 10001 01110'],
  ['6', '00110 01000 10000 11110 10001 10001 01110'],
  ['7', '11111 00001 00010 00100 01000 01000 01000'],
  ['8', '01110 10001 10001 01110 10001 10001 01110'],
  ['9', '01110 10001 10001 01111 00001 00010 01100'],
  ['A', '01110 10001 10001 11111 10001 10001 10001'],
  ['B', '11110 10001 10001 11110 10001 10001 11110'],
  ['C', '01110 10001 10000 10000 10000 10001 01110'],
  ['D', '11110 10001 10001 10001 10001 10001 11110'],
  ['E', '11111 10000 10000 11110 10000 10000 11111'],
  ['F', '11111 10000 10000 11110 10000 10000 10000'],
  ['G', '01110 10001 10000 10111 10001 10001 01111'],
  ['H', '10001 10001 10001 11111 10001 10001 10001'],
  ['I', '01110 00100 00100 00100 00100 00100 01110'],
  ['J', '00111 00010 00010 00010 00010 10010 01100'],
  ['K', '10001 10010 10100 11000 10100 10010 10001'],
  ['L', '10000 10000 10000 10000 10000 10000 11111'],
  ['M', '10001 11011 10101 10101 10001 10001 10001'],
  ['N', '10001 10001 11001 10101 10011 10001 10001'],
  ['O', '01110 10001 10001 10001 10001 10001 01110'],
  ['P', '11110 10001 10001 11110 10000 10000 10000'],
  ['Q', '01110 10001 10001 10001 10101 10010 01101'],
  ['R', '11110 10001 10001 11110 10100 10010 10001'],
  ['S', '01111 10000 10000 01110 00001 00001 11110'],
  ['T', '11111 00100 00100 00100 00100 00100 00100'],
  ['U', '10001 10001 10001 10001 10001 10001 01110'],
  ['V', '10001 10001 10001 10001 10001 01010 00100'],
  ['W', '10001 10001 10001 10101 10101 10101 01010'],
  ['X', '10001 10001 01010 00100 01010 10001 10001'],
  ['Y', '10001 10001 10001 01010 00100 00100 00100'],
  ['Z', '11111 00001 00010 00100 01000 10000 11111'],
  // Lowercase: x-height rows 2-6, ascenders from row 0, descenders on rows 7-8.
  ['a', '00000 00000 01110 00001 01111 10001 01111'],
  ['b', '10000 10000 10110 11001 10001 10001 11110'],
  ['c', '00000 00000 01110 10000 10000 10001 01110'],
  ['d', '00001 00001 01101 10011 10001 10001 01111'],
  ['e', '00000 00000 01110 10001 11111 10000 01110'],
  ['f', '00110 01001 01000 11100 01000 01000 01000'],
  ['g', '00000 00000 01111 10001 10001 10001 01111 00001 01110'],
  ['h', '10000 10000 10110 11001 10001 10001 10001'],
  ['i', '00100 00000 01100 00100 00100 00100 01110'],
  ['j', '00010 00000 00110 00010 00010 00010 00010 10010 01100'],
  ['k', '10000 10000 10010 10100 11000 10100 10010'],
  ['l', '01100 00100 00100 00100 00100 00100 01110'],
  ['m', '00000 00000 11010 10101 10101 10001 10001'],
  ['n', '00000 00000 10110 11001 10001 10001 10001'],
  ['o', '00000 00000 01110 10001 10001 10001 01110'],
  ['p', '00000 00000 11110 10001 10001 10001 11110 10000 10000'],
  ['q', '00000 00000 01111 10001 10001 10001 01111 00001 00001'],
  ['r', '00000 00000 10110 11001 10000 10000 10000'],
  ['s', '00000 00000 01111 10000 01110 00001 11110'],
  ['t', '01000 01000 11100 01000 01000 01001 00110'],
  ['u', '00000 00000 10001 10001 10001 10011 01101'],
  ['v', '00000 00000 10001 10001 10001 01010 00100'],
  ['w', '00000 00000 10001 10001 10101 10101 01010'],
  ['x', '00000 00000 10001 01010 00100 01010 10001'],
  ['y', '00000 00000 10001 10001 10001 10001 01111 00001 01110'],
  ['z', '00000 00000 11111 00010 00100 01000 11111'],
  [' ', '00000'],
  ['.', '00000 00000 00000 00000 00000 01100 01100'],
  [',', '00000 00000 00000 00000 00000 01100 00100 01000'],
  [':', '00000 01100 01100 00000 01100 01100 00000'],
  [';', '00000 01100 01100 00000 01100 00100 01000'],
  ['-', '00000 00000 00000 11111 00000 00000 00000'],
  ['+', '00000 00100 00100 11111 00100 00100 00000'],
  ['=', '00000 00000 11111 00000 11111 00000 00000'],
  ['_', '00000 00000 00000 00000 00000 00000 11111'],
  ['/', '00001 00010 00010 00100 01000 01000 10000'],
  ['(', '00010 00100 01000 01000 01000 00100 00010'],
  [')', '01000 00100 00010 00010 00010 00100 01000'],
  ['[', '01110 01000 01000 01000 01000 01000 01110'],
  [']', '01110 00010 00010 00010 00010 00010 01110'],
  ['!', '00100 00100 00100 00100 00100 00000 00100'],
  ['?', '01110 10001 00001 00010 00100 00000 00100'],
  ["'", '00100 00100 01000'],
  ['"', '01010 01010 10100'],
  ['#', '01010 01010 11111 01010 11111 01010 01010'],
  ['%', '11000 11001 00010 00100 01000 10011 00011'],
  ['*', '00000 00100 10101 01110 10101 00100 00000'],
  ['<', '00010 00100 01000 10000 01000 00100 00010'],
  ['>', '01000 00100 00010 00001 00010 00100 01000'],
  ['@', '01110 10001 10111 10101 10111 10000 01110'],
  ['|', '00100 00100 00100 00100 00100 00100 00100'],
  ['&', '01100 10010 10100 01000 10101 10010 01101'],
  ['·', '00000 00000 00000 00100 00000 00000 00000'],
  ['×', '00000 10001 01010 00100 01010 10001 00000'],
  ['°', '01100 10010 01100'],
  ['›', '00000 01000 00100 00010 00100 01000 00000'],
  ['^', '00100 01010 10001'],
  ['~', '00000 00000 01000 10101 00010 00000 00000'],
];

function build(name: string, source: Source, o: { width: number; height: number; lineHeight: number; caps: boolean }, marks: { grave: readonly number[]; acute: readonly number[] }, lowerRows: number): Font {
  const glyphs = parse(source);
  accents(glyphs, marks, lowerRows);
  return { name, width: o.width, height: o.height, advance: o.width + 1, lineHeight: o.lineHeight, caps: o.caps, glyphs };
}

const SMALL_MARKS = { grave: [0b100], acute: [0b001] };
const LARGE_MARKS = { grave: [0b01000, 0b00100], acute: [0b00010, 0b00100] };

/** 3x5 with lowercase, accents and descenders; lines 7 px apart. */
export const SMALL = build('3x5', SMALL_SOURCE, { width: 3, height: 5, lineHeight: 7, caps: false }, SMALL_MARKS, 1);
/** The same glyphs with lowercase drawn as capitals, for sheet labels; lines 6 px apart. */
export const SMALL_CAPS: Font = { ...SMALL, name: '3x5 maiuscolo', lineHeight: 6, caps: true };
/** 5x7 with lowercase, accents and descenders, for titles; lines 11 px apart. */
export const LARGE = build('5x7', LARGE_SOURCE, { width: 5, height: 7, lineHeight: 11, caps: false }, LARGE_MARKS, 2);

// The 3x5 labels API of the preview sheets.
export const GLYPH_W = 3;
export const GLYPH_H = 5;
export const ADVANCE = 4;
export const LINE_HEIGHT = 6;

/** Characters a font can draw; anything else is drawn as '?'. */
export function charset(font: Font = SMALL): string {
  return [...font.glyphs.keys()].join('');
}

/** Characters of the sheet labels (capitals, digits, punctuation, accented capitals). */
export const CHARSET = [...SMALL.glyphs.keys()].filter((c) => c === c.toUpperCase()).join('');

function glyph(font: Font, ch: string): Glyph {
  const c = font.caps ? ch.toUpperCase() : ch;
  return font.glyphs.get(c) ?? (font.glyphs.get('?') as Glyph);
}

/** Width in pixels of a single line of text. */
export function textWidth(text: string, font: Font = SMALL_CAPS): number {
  return text.length === 0 ? 0 : text.length * font.advance - 1;
}

/** Draws one line of text with the top-left corner of its capitals at (x, y), clipped. */
export function drawText(buf: IndexedBuffer, text: string, x: number, y: number, index: number, font: Font = SMALL_CAPS): void {
  const w = font.width;
  for (let i = 0; i < text.length; i++) {
    const g = glyph(font, text[i]);
    const ox = x + i * font.advance;
    for (let r = 0; r < g.rows.length; r++) {
      const bits = g.rows[r];
      if (bits === 0) continue;
      for (let col = 0; col < w; col++) if ((bits >> (w - 1 - col)) & 1) buf.set(ox + col, y + g.top + r, index);
    }
  }
}

/** Longest prefix of `text` that fits in `width` pixels, with "…" as ".." when cut. */
export function fitText(text: string, width: number, font: Font = SMALL): string {
  if (textWidth(text, font) <= width) return text;
  let n = text.length;
  while (n > 0 && textWidth(`${text.slice(0, n)}..`, font) > width) n--;
  return `${text.slice(0, n)}..`;
}
