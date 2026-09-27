// Icons at 8 and 12 pixels, drawn from primitives (discs, lines, arcs) by functions: no bitmaps.

import { IndexedBuffer } from '../../core/buffer';
import { cos, PI, sin, TAU } from '../../core/dmath';
import { masterPalette } from '../../toolkit/palette';
import { circle, disc, line, rect } from '../draw';

const palette = masterPalette();

export const ICONS = ['galaxy', 'sector', 'system', 'star', 'planet', 'moon', 'belt', 'comet', 'search', 'pause', 'play', 'fast', 'close', 'surface'] as const;
export type IconName = (typeof ICONS)[number];

type Painter = (b: IndexedBuffer, n: number, ink: number, dim: number) => void;

/** n is the icon side (8 or 12); coordinates are in a 0..n box. */
const PAINTERS: Record<IconName, Painter> = {
  galaxy(b, n, ink, dim) {
    // Two spiral arms around a bright core.
    const c = n / 2;
    for (let arm = 0; arm < 2; arm++) {
      for (let t = 0; t < 1; t += 0.02) {
        const a = arm * PI + t * 1.4 * PI;
        const r = 0.8 + t * (n / 2 - 1);
        b.set(Math.floor(c + r * cos(a)), Math.floor(c + r * sin(a) * 0.7), t < 0.5 ? ink : dim);
      }
    }
    disc(b, c, c, n / 8 + 0.5, ink);
  },
  sector(b, n, ink, dim) {
    const h = n / 2;
    rect(b, 0, 0, n, 1, dim);
    rect(b, 0, n - 1, n, 1, dim);
    rect(b, 0, 0, 1, n, dim);
    rect(b, n - 1, 0, 1, n, dim);
    rect(b, Math.floor(h), 0, 1, n, dim);
    rect(b, 0, Math.floor(h), n, 1, dim);
    b.set(Math.floor(h / 2), Math.floor(h / 2), ink);
    b.set(Math.floor(h + h / 2), Math.floor(h + h / 3), ink);
  },
  system(b, n, ink, dim) {
    const c = n / 2;
    circle(b, c - 0.5, c - 0.5, n / 2 - 1, dim, true);
    disc(b, c, c, n / 8 + 0.4, ink);
    b.set(Math.round(c + (n / 2 - 1) * cos(-0.8)) - 1, Math.round(c + (n / 2 - 1) * sin(-0.8)) - 1, ink);
  },
  star(b, n, ink, dim) {
    const c = n / 2;
    for (let k = 0; k < 4; k++) {
      const a = (k * TAU) / 4;
      line(b, c - 0.5, c - 0.5, c - 0.5 + cos(a) * (n / 2 - 0.5), c - 0.5 + sin(a) * (n / 2 - 0.5), dim);
    }
    disc(b, c, c, n / 4, ink);
  },
  planet(b, n, ink, dim) {
    const c = n / 2;
    disc(b, c, c, n / 3.2, ink);
    for (let x = 0; x < n; x++) {
      const t = x / (n - 1);
      const y = Math.round(c + (t - 0.5) * n * 0.35);
      if (x < c - n / 3.2 || x >= c + n / 3.2 - 0.5) b.set(x, y, dim);
    }
  },
  moon(b, n, ink) {
    const c = n / 2;
    disc(b, c, c, n / 2 - 0.5, ink);
    const cut = new IndexedBuffer(n, n);
    disc(cut, c + n / 4, c - n / 8, n / 2 - 1, 1);
    for (let i = 0; i < b.data.length; i++) if (cut.data[i] === 1) b.data[i] = 0;
  },
  belt(b, n, ink, dim) {
    for (let k = 0; k < 7; k++) {
      const a = PI + (k / 6) * PI;
      b.set(Math.floor(n / 2 + cos(a) * (n / 2 - 1)), Math.floor(n / 2 + sin(a) * (n / 2 - 1) * -0.6 + n / 8), k % 2 === 0 ? ink : dim);
    }
    disc(b, n / 2, n / 2 + n / 4, n / 10 + 0.4, ink);
  },
  comet(b, n, ink, dim) {
    line(b, 1, n - 2, n - 3, 2, dim);
    line(b, 1, n - 4, n - 5, 2, dim, 1);
    disc(b, n - 2.5, 2.5, n / 7 + 0.5, ink);
  },
  search(b, n, ink) {
    circle(b, n * 0.4 - 0.5, n * 0.4 - 0.5, n * 0.3, ink);
    line(b, n * 0.62, n * 0.62, n - 1, n - 1, ink);
  },
  pause(b, n, ink) {
    const w = Math.max(1, Math.round(n / 4));
    rect(b, Math.round(n / 4) - 1, 1, w, n - 2, ink);
    rect(b, n - Math.round(n / 4) - w + 1, 1, w, n - 2, ink);
  },
  play(b, n, ink) {
    for (let x = 1; x < n - 1; x++) {
      const half = ((x - 1) / (n - 3)) * (n / 2 - 1);
      line(b, x, n / 2 - (n / 2 - 1 - half), x, n / 2 - 1 + (n / 2 - 1 - half), ink);
    }
  },
  fast(b, n, ink) {
    const w = Math.floor(n / 2);
    for (const x0 of [0, w]) {
      for (let x = 0; x < w; x++) {
        const half = (w - 1 - x) * ((n / 2 - 1) / (w - 1 || 1));
        line(b, x0 + x, n / 2 - 1 - half, x0 + x, n / 2 + half - 1, ink);
      }
    }
  },
  close(b, n, ink) {
    line(b, 1, 1, n - 2, n - 2, ink);
    line(b, n - 2, 1, 1, n - 2, ink);
  },
  surface(b, n, ink, dim) {
    rect(b, 0, 1, n, n - 2, dim);
    for (let x = 1; x < n - 1; x++) {
      const y = Math.round(n / 2 + sin((x / n) * TAU) * (n / 5));
      line(b, x, y, x, n - 3, ink);
    }
  },
};

const cache = new Map<string, IndexedBuffer>();

/** An icon at 8 or 12 pixels, `ink` for the main shape and `dim` for secondary strokes. */
export function icon(name: IconName, size: 8 | 12, ink = palette.index('ui-cool', 3), dim = palette.index('ui-cool', 1)): IndexedBuffer {
  const key = `${name}|${size}|${ink}|${dim}`;
  let b = cache.get(key);
  if (b === undefined) {
    b = new IndexedBuffer(size, size);
    PAINTERS[name](b, size, ink, dim);
    cache.set(key, b);
  }
  return b;
}
