// Temporary step 2 preview (replaced by the forge CLI at step 3): `npx tsx forge/step2-preview.ts`.
//   out/step2-palette.png   every ramp with its name, plus the master palette, x8
//   out/step2-shading.png   a sphere and a bevelled rectangle per ramp, lit from 8 directions, x3
//   out/step2-shading-1x.png the same at 1x

import { FloatField, IndexedBuffer } from '../core/buffer';
import { cos, PI, sin } from '../core/dmath';
import { fixCorners } from '../toolkit/cleanup';
import { drawText, LINE_HEIGHT, textWidth } from '../toolkit/font';
import { direction } from '../toolkit/light';
import { outline } from '../toolkit/outline';
import { masterPalette } from '../toolkit/palette';
import { shade } from '../toolkit/shade';
import { writePng } from './png';

const palette = masterPalette();
const BG = palette.index('space', 0);
const INK = palette.index('ui-cool', 3);
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

const sheet = paletteSheet();
writePng('out/step2-palette.png', palette.toRGBA(sheet), sheet.w, sheet.h, 8);
const shading = shadingSheet();
writePng('out/step2-shading.png', palette.toRGBA(shading), shading.w, shading.h, 3);
writePng('out/step2-shading-1x.png', palette.toRGBA(shading), shading.w, shading.h, 1);
console.log(`palette ${sheet.w}x${sheet.h} (x8), shading ${shading.w}x${shading.h} (x3 and x1)`);
