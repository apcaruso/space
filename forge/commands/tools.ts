// Tool commands: swatches (palette and shading reference sheets) and zoom (close-up of a PNG).

import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { FloatField, IndexedBuffer } from '../../core/buffer';
import { cos, PI, sin } from '../../core/dmath';
import { fixCorners } from '../../toolkit/cleanup';
import { drawText, LINE_HEIGHT, textWidth } from '../../toolkit/font';
import { direction } from '../../toolkit/light';
import { outline } from '../../toolkit/outline';
import { shade } from '../../toolkit/shade';
import { UsageError } from '../args';
import { BG, INK, outputPath, palette, positiveInt, savePng, writeOutput, type Command } from '../common';
import { encodePng } from '../png';

const DIM = palette.index('ui-cool', 1);

const labelW = Math.max(...palette.ramps.map((r) => textWidth(r.name))) + 4;

/** A size x size swatch framed in the darkest colour, so it shows on any background. */
function swatchAt(buf: IndexedBuffer, x0: number, y0: number, size: number, index: number): void {
  for (let dy = -1; dy <= size; dy++) {
    for (let dx = -1; dx <= size; dx++) {
      const edge = dx < 0 || dy < 0 || dx === size || dy === size;
      buf.set(x0 + dx, y0 + dy, edge ? BG : index);
    }
  }
}

function paletteSheet(): IndexedBuffer {
  const swatch = 5;
  const bg = palette.index('basalt', 3);
  const perRow = 16;
  const step = swatch + 2;
  const rampsH = palette.ramps.length * (LINE_HEIGHT + 2);
  const masterRows = Math.ceil((palette.size - 1) / perRow);
  const w = Math.max(labelW + 6 * step + 4, 4 + perRow * step);
  const h = 3 + rampsH + 4 + LINE_HEIGHT + 1 + masterRows * step + 3;
  const buf = new IndexedBuffer(w, h).fill(bg);
  palette.ramps.forEach((ramp, row) => {
    const y = 3 + row * (LINE_HEIGHT + 2);
    drawText(buf, ramp.name, 2, y, INK);
    ramp.indices.forEach((index, t) => swatchAt(buf, labelW + 1 + t * step, y, swatch, index));
  });
  const my = 3 + rampsH + 4;
  drawText(buf, `master ${palette.size - 1}`, 2, my, INK);
  for (let i = 1; i < palette.size; i++) {
    const x0 = 3 + ((i - 1) % perRow) * step;
    const y0 = my + LINE_HEIGHT + 1 + Math.floor((i - 1) / perRow) * step;
    swatchAt(buf, x0, y0, swatch, i);
  }
  return buf;
}

const CELL = 24;

/** Height field and material map of a sphere of radius r centred in a CELL x CELL square. */
function sphere(r: number): [FloatField, IndexedBuffer] {
  const heights = new FloatField(CELL, CELL);
  const mats = new IndexedBuffer(CELL, CELL);
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        heights.set(x, y, Math.sqrt(r * r - d2));
        mats.set(x, y, 1);
      }
    }
  }
  return [heights, mats];
}

/** Rounded rectangle with a flat top and bevelled edges. */
function bevelBox(hw: number, hh: number, radius: number, bevel: number): [FloatField, IndexedBuffer] {
  const heights = new FloatField(CELL, CELL);
  const mats = new IndexedBuffer(CELL, CELL);
  const c = CELL / 2;
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const qx = Math.abs(x + 0.5 - c) - hw + radius;
      const qy = Math.abs(y + 0.5 - c) - hh + radius;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - radius;
      if (d < 0) {
        heights.set(x, y, Math.min(1, -d / bevel) * bevel);
        mats.set(x, y, 1);
      }
    }
  }
  return [heights, mats];
}

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function shadingSheet(): IndexedBuffer {
  const shapes = [sphere(10), bevelBox(10, 7, 3, 3)];
  const gap = 6;
  const top = 3 + LINE_HEIGHT + 2;
  const w = labelW + shapes.length * DIRECTIONS.length * CELL + gap + 2;
  const h = top + palette.ramps.length * CELL + 2;
  const buf = new IndexedBuffer(w, h).fill(BG);
  const outlineColours = palette.darkestIndices();

  shapes.forEach((_, s) => {
    DIRECTIONS.forEach((name, d) => {
      const x = labelW + (s * DIRECTIONS.length + d) * CELL + s * gap;
      drawText(buf, name, x + Math.floor((CELL - textWidth(name)) / 2), 3, DIM);
    });
  });

  palette.ramps.forEach((ramp, row) => {
    const y = top + row * CELL;
    drawText(buf, ramp.name, 2, y + Math.floor((CELL - 5) / 2), INK);
    shapes.forEach(([heights, mats], s) => {
      DIRECTIONS.forEach((_, d) => {
        // N is up (-y); directions turn clockwise, the light sits 40 degrees above the horizon.
        const a = (d * PI) / 4 - PI / 2;
        const light = direction(cos(a) * 0.77, sin(a) * 0.77, 0.64);
        let sprite = shade(heights, mats, [{ ramp: ramp.name }], palette, { light });
        sprite = fixCorners(outline(sprite, palette), outlineColours);
        buf.blit(sprite, labelW + (s * DIRECTIONS.length + d) * CELL + s * gap, y);
      });
    });
  });
  return buf;
}


export const swatches: Command = {
  name: 'swatches',
  usage: 'swatches [--scale n] [-o out/palette.png]',
  summary: 'foglio della palette (ogni rampa con il nome) e foglio di shading (sfera e smusso per rampa, 8 luci)',
  options: {
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento del foglio di shading, default 3 (quello della palette usa 8)' },
    out: { kind: 'string', value: 'out/file.png', short: 'o', doc: 'percorso del foglio della palette; quello di shading va accanto' },
  },
  run(args, io) {
    if (args.positionals.length > 0) throw new UsageError(`swatches: argomento inatteso "${args.positionals[0]}"`);
    const palettePath = outputPath(args.values.out, 'palette.png');
    const shadingPath = palettePath.replace(/\.png$/, '') + '-shading.png';
    const scale = positiveInt(args.values, 'scale', 3);
    const sheet = paletteSheet();
    savePng(palettePath, sheet, 8);
    const shading = shadingSheet();
    savePng(shadingPath, shading, scale);
    io.out(`${palettePath}  ${palette.size - 1} colori, ${palette.ramps.length} rampe  x8`);
    io.out(`${shadingPath}  ${shading.w}x${shading.h} x${scale}`);
    return 0;
  },
};

export const zoom: Command = {
  name: 'zoom',
  usage: 'zoom <file.png> --x n --y n --w n --h n [--scale 8] [-o out/zoom.png]',
  summary: 'ritaglia una zona di un PNG qualsiasi e la ingrandisce, per guardare i singoli pixel',
  options: {
    x: { kind: 'int', value: 'px', doc: 'bordo sinistro della zona' },
    y: { kind: 'int', value: 'px', doc: 'bordo superiore della zona' },
    w: { kind: 'int', value: 'px', doc: 'larghezza della zona' },
    h: { kind: 'int', value: 'px', doc: 'altezza della zona' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento, default 8' },
    grid: { kind: 'flag', doc: 'disegna la griglia dei pixel' },
    out: { kind: 'string', value: 'out/file.png', short: 'o', doc: 'file di uscita, dentro out/' },
  },
  run(args, io) {
    const file = args.positionals[0];
    if (file === undefined) throw new UsageError('zoom: manca il PNG di ingresso');
    const v = args.values;
    const png = PNG.sync.read(readFileSync(file));
    const x0 = typeof v.x === 'number' ? v.x : 0;
    const y0 = typeof v.y === 'number' ? v.y : 0;
    const w = positiveInt(v, 'w', png.width - x0);
    const h = positiveInt(v, 'h', png.height - y0);
    if (x0 < 0 || y0 < 0 || x0 + w > png.width || y0 + h > png.height) {
      throw new UsageError(`zoom: la zona ${x0},${y0} ${w}x${h} esce dall'immagine ${png.width}x${png.height}`);
    }
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) rgba.set(png.data.subarray(((y0 + y) * png.width + x0) * 4, ((y0 + y) * png.width + x0 + w) * 4), y * w * 4);
    const scale = positiveInt(v, 'scale', 8);
    const path = outputPath(v.out, 'zoom.png');
    writeOutput(path, encodePng(rgba, w, h, { scale, grid: v.grid === true }));
    io.out(`${path}  ${file} ${x0},${y0} ${w}x${h} x${scale}`);
    return 0;
  },
};
