// Shared pieces of the forge commands: output paths, recipes, options, images and grids.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { IndexedBuffer } from '../core/buffer';
import { DEFAULT_AZIMUTH, DEFAULT_ELEVATION, type GenerateOptions } from '../gen/registry';
import { drawText, LINE_HEIGHT, textWidth } from '../toolkit/font';
import { lightFromAngle } from '../toolkit/light';
import { masterPalette } from '../toolkit/palette';
import { UsageError, type OptionSpecs, type ParsedArgs } from './args';
import { encodePng } from './png';

export const palette = masterPalette();
/** Space background for --bg. */
export const BG = palette.index('space', 0);
export const INK = palette.index('ui-cool', 3);
export const DIM = palette.index('ui-cool', 2);

export const OUT_DIR = 'out';

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

export interface Command {
  readonly name: string;
  readonly usage: string;
  readonly summary: string;
  readonly options: OptionSpecs;
  run(args: ParsedArgs, io: Io): number;
}

/** Options shared by every command that runs a generator. */
export const GEN_OPTIONS: OptionSpecs = {
  recipe: { kind: 'string', value: 'file.json', doc: 'ricetta JSON; i campi mancanti prendono i default' },
  size: { kind: 'int', value: 'px', doc: 'lato dello sprite (default: quello del generatore)' },
  frame: { kind: 'int', value: 'n', doc: 'frame dell\'animazione, default 0' },
  light: { kind: 'number', value: 'gradi', doc: `direzione della luce: 0 = dall'alto, in senso orario (default ${DEFAULT_AZIMUTH})` },
  elev: { kind: 'number', value: 'gradi', doc: `elevazione della luce sul piano dell'immagine (default ${DEFAULT_ELEVATION})` },
  scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, senza interpolazione' },
  bg: { kind: 'flag', doc: 'sfondo spazio invece della trasparenza' },
  out: { kind: 'string', value: 'out/file', short: 'o', doc: 'file di uscita, dentro out/' },
};

/** The output path: given or default, and always inside out/. */
export function outputPath(given: unknown, fallback: string): string {
  const path = typeof given === 'string' ? given : `${OUT_DIR}/${fallback}`;
  const root = resolve(OUT_DIR);
  const full = resolve(path);
  if (!full.startsWith(root + sep)) throw new UsageError(`l'uscita deve stare dentro ${OUT_DIR}/, ricevuto "${path}"`);
  return path;
}

export function writeOutput(path: string, bytes: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/** Recipe input from --recipe (validated later by the registry), or {}. */
export function readRecipe(path: unknown): unknown {
  if (typeof path !== 'string') return {};
  if (!existsSync(path)) throw new UsageError(`--recipe: file non trovato: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new UsageError(`--recipe: ${path} non è JSON valido: ${(e as Error).message}`);
  }
}

export function positiveInt(values: ParsedArgs['values'], name: string, fallback: number): number {
  const v = values[name] ?? fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new UsageError(`--${name} deve essere un intero positivo, ricevuto ${String(v)}`);
  return v;
}

/** Generate options from --size, --frame, --light, --elev. */
export function genOptions(values: ParsedArgs['values']): Partial<GenerateOptions> {
  const opts: { size?: number; frame?: number; lightDir?: GenerateOptions['lightDir'] } = {};
  if (typeof values.size === 'number') opts.size = values.size;
  if (typeof values.frame === 'number') opts.frame = values.frame;
  if (typeof values.light === 'number' || typeof values.elev === 'number') {
    const azimuth = typeof values.light === 'number' ? values.light : DEFAULT_AZIMUTH;
    const elevation = typeof values.elev === 'number' ? values.elev : DEFAULT_ELEVATION;
    opts.lightDir = lightFromAngle(azimuth, elevation);
  }
  return opts;
}

export function generatorName(args: ParsedArgs, command: string): string {
  const name = args.positionals[0];
  if (name === undefined) throw new UsageError(`${command}: manca il nome del generatore (vedi "forge list")`);
  if (args.positionals.length > 1) throw new UsageError(`${command}: argomento inatteso "${args.positionals[1]}"`);
  return name;
}

/** Copy of a buffer over the space background, or the buffer itself. */
export function withBackground(buf: IndexedBuffer, bg: boolean): IndexedBuffer {
  if (!bg) return buf;
  return new IndexedBuffer(buf.w, buf.h).fill(BG).blit(buf, 0, 0);
}

export function savePng(path: string, buf: IndexedBuffer, scale: number, grid = false): void {
  writeOutput(path, encodePng(palette.toRGBA(buf), buf.w, buf.h, { scale, grid }));
}

export interface GridOptions {
  readonly bg: boolean;
  readonly title?: string;
  readonly colLabels?: readonly string[];
  readonly rowLabels?: readonly string[];
}

export interface Cell {
  readonly buffer: IndexedBuffer;
  readonly label?: string;
}

const MARGIN = 2;
const GAP = 2;

/**
 * Lays out rows of cells at 1x: optional title, column labels on top, row labels on the left,
 * each cell's label under it, all in the 3x5 font.
 */
export function composeGrid(rows: readonly (readonly Cell[])[], opts: GridOptions): IndexedBuffer {
  const cells = rows.flat();
  const labelled = cells.some((c) => c.label !== undefined);
  const cellW = Math.max(...cells.map((c) => Math.max(c.buffer.w, textWidth(c.label ?? ''))), ...(opts.colLabels ?? []).map(textWidth));
  const spriteH = Math.max(...cells.map((c) => c.buffer.h));
  const cellH = spriteH + (labelled ? LINE_HEIGHT : 0);
  const cols = Math.max(...rows.map((r) => r.length));
  const left = opts.rowLabels === undefined ? 0 : Math.max(...opts.rowLabels.map(textWidth)) + 3;
  const top = (opts.title === undefined ? 0 : LINE_HEIGHT + 1) + (opts.colLabels === undefined ? 0 : LINE_HEIGHT);
  const w = MARGIN * 2 + left + cols * cellW + (cols - 1) * GAP;
  const h = MARGIN * 2 + top + rows.length * cellH + (rows.length - 1) * GAP;
  const out = new IndexedBuffer(w, h);
  if (opts.bg) out.fill(BG);

  if (opts.title !== undefined) drawText(out, opts.title, MARGIN, MARGIN, INK);
  const colY = MARGIN + (opts.title === undefined ? 0 : LINE_HEIGHT + 1);
  opts.colLabels?.forEach((label, c) => {
    const x = MARGIN + left + c * (cellW + GAP) + Math.floor((cellW - textWidth(label)) / 2);
    drawText(out, label, x, colY, DIM);
  });
  rows.forEach((row, r) => {
    const y0 = MARGIN + top + r * (cellH + GAP);
    const rowLabel = opts.rowLabels?.[r];
    if (rowLabel !== undefined) drawText(out, rowLabel, MARGIN, y0 + Math.floor((spriteH - 5) / 2), DIM);
    row.forEach((cell, c) => {
      const x0 = MARGIN + left + c * (cellW + GAP);
      out.blit(cell.buffer, x0 + Math.floor((cellW - cell.buffer.w) / 2), y0 + Math.floor((spriteH - cell.buffer.h) / 2));
      if (cell.label !== undefined) drawText(out, cell.label, x0 + Math.floor((cellW - textWidth(cell.label)) / 2), y0 + spriteH + 1, INK);
    });
  });
  return out;
}

/** Splits a flat list into rows of `cols`. */
export function chunk<T>(items: readonly T[], cols: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return rows;
}
