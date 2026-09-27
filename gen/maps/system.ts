// System view: a schematic top-down map of one system at a given tick. Distances use a
// logarithmic scale, so close-in and far-out orbits share one image; stars, planets and belt
// asteroids are drawn by their generators, lit from the centre of the system.

import { IndexedBuffer } from '../../core/buffer';
import { cos, log, PI, sin, TAU } from '../../core/dmath';
import { derive } from '../../core/hash';
import { Rng } from '../../core/rng';
import { BAYER4, bayerThreshold } from '../../toolkit/dither';
import { drawText, LINE_HEIGHT, textWidth } from '../../toolkit/font';
import { direction, type Vec3 } from '../../toolkit/light';
import { masterPalette } from '../../toolkit/palette';
import { backgroundRegion, type SectorInfo } from '../../universe/galaxy';
import { apoapsis, orbitPosition, periodTicks, type Orbit } from '../../universe/orbit';
import { rotationFrame, starPosition, type Planet, type StarSystem } from '../../universe/system';
import { registry } from '../index';
import { starClass } from '../star/classes';

const palette = masterPalette();
const ORBIT = palette.index('space', 2);
const COMET_PATH = palette.index('gas-cold', 0);
const HABITABLE = palette.index('vegetation', 0);
const TITLE = palette.index('ui-cool', 3);
const TEXT = palette.index('ui-cool', 2);
const LABEL = palette.index('ui-cool', 1);

export interface SystemViewOptions {
  /** Side of the square image, 64..512. */
  readonly size: number;
  /** Game time: positions on the orbits. */
  readonly tick: number;
  /** Frame for rotations and palette cycling; defaults to the tick. Animations pass their frame
   * number, so surfaces turn smoothly whatever the time step. */
  readonly frame?: number;
  /** Names, star classes and the tick in the corners. */
  readonly labels?: boolean;
}

/** Logarithmic radial scale: AU from the barycentre to pixels from the image centre. */
class RadialScale {
  constructor(
    private readonly inner: number,
    private readonly outer: number,
    private readonly r0: number,
    private readonly rMax: number,
  ) {}

  px(au: number): number {
    return this.inner + ((this.outer - this.inner) * log(1 + au / this.r0)) / log(1 + this.rMax / this.r0);
  }

  /** A point in AU (x right, y down) to image pixels, keeping its direction. */
  point(x: number, y: number, cx: number, cy: number): [number, number] {
    const r = Math.sqrt(x * x + y * y);
    if (r === 0) return [cx, cy];
    const k = this.px(r) / r;
    return [cx + x * k, cy + y * k];
  }
}

function line(buf: IndexedBuffer, x0: number, y0: number, x1: number, y1: number, index: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    buf.set(x, y, index);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** The whole ellipse of an orbit through the radial scale; `dotted` skips every other segment. */
function drawOrbit(buf: IndexedBuffer, o: Orbit, scale: RadialScale, cx: number, cy: number, index: number, dotted = false): void {
  const steps = 160;
  const b = o.a * Math.sqrt(1 - o.e * o.e);
  const c = cos(o.omega);
  const s = sin(o.omega);
  let prev: [number, number] | null = null;
  for (let i = 0; i <= steps; i++) {
    const E = (TAU * i) / steps;
    const px = o.a * (cos(E) - o.e);
    const py = b * sin(E);
    const p = scale.point(px * c - py * s, px * s + py * c, cx, cy);
    if (prev !== null && (!dotted || i % 2 === 0)) line(buf, prev[0], prev[1], p[0], p[1], index);
    prev = p;
  }
}

/** Light for a body at (x, y) from a star at (sx, sy), raised a little above the plane. */
function lightFrom(sx: number, sy: number, x: number, y: number): Vec3 | undefined {
  const dx = sx - x;
  const dy = sy - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-9) return undefined;
  const e = (20 * PI) / 180;
  return direction((dx / len) * cos(e), (dy / len) * cos(e), sin(e));
}

/** Blits a generator result centred on (x, y). */
function place(buf: IndexedBuffer, r: { buffer: IndexedBuffer; descriptor: Record<string, unknown> }, x: number, y: number): void {
  const centre = Array.isArray(r.descriptor.centre) ? (r.descriptor.centre as number[]) : [r.buffer.w / 2, r.buffer.h / 2];
  buf.blit(r.buffer, Math.round(x - centre[0]), Math.round(y - centre[1]));
}

const MOON_TONES: Readonly<Record<string, readonly [string, number, number]>> = {
  cratered: ['rock', 3, 1],
  dead: ['ash', 2, 0],
  ice: ['ice', 3, 1],
  lava: ['magma', 3, 1],
};

/** Planet sprite side in pixels: rocky worlds at the smallest planet size, giants bigger. */
function planetSize(p: Planet, big: boolean): number {
  if (p.archetype !== 'gas') return 16;
  return Math.round(16 + ((p.radius - 3.5) / 8.5) * (big ? 16 : 8));
}

/** Star disc size: the star generator scales it by class. */
function starSize(big: boolean): number {
  return big ? 24 : 18;
}

export function systemView(system: StarSystem, sector: SectorInfo, o: SystemViewOptions): IndexedBuffer {
  const W = o.size;
  const tick = o.tick;
  const frame = o.frame ?? tick;
  const big = W >= 320;
  const cx = W / 2;
  const cy = W / 2;

  const bg = registry.run('background', { region: backgroundRegion(sector), chunk: { x: 0, y: 0 } }, derive(system.seed, 'backdrop'), { size: W, frame });
  const buf = new IndexedBuffer(W, W).blit(bg.buffer, 0, 0);

  // Scale: from just outside the star(s) to just inside the frame.
  const pairStars = system.stars.slice(0, 2);
  const discs = pairStars.map((s) => (starSize(big) * starClass(s.class).scale) / 2);
  const pairOffset = pairStars.length === 2 ? Math.max(...discs) + 2 : 0;
  const inner = pairOffset + Math.max(...discs) + 6;
  let rMax = 0;
  let r0 = Infinity;
  for (const p of system.planets) {
    rMax = Math.max(rMax, apoapsis(p.orbit));
    r0 = Math.min(r0, p.orbit.a);
  }
  for (const b of system.belts) {
    rMax = Math.max(rMax, b.outer);
    r0 = Math.min(r0, b.inner);
  }
  if (rMax === 0) {
    rMax = system.habitable[1] * 2;
    r0 = system.habitable[0];
  }
  const outer = W / 2 - (big ? 20 : 14);
  const scale = new RadialScale(inner, outer, r0 * 0.5, rMax);

  // Habitable zone: a sparse green band.
  const h0 = scale.px(system.habitable[0]);
  const h1 = scale.px(system.habitable[1]);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.sqrt((x + 0.5 - cx) * (x + 0.5 - cx) + (y + 0.5 - cy) * (y + 0.5 - cy));
      if (d >= h0 && d <= h1 && d > inner && d < outer + 8 && bayerThreshold(BAYER4, x, y) < 0.19) buf.set(x, y, HABITABLE);
    }
  }

  for (const c of system.comets) drawOrbit(buf, c.orbit, scale, cx, cy, COMET_PATH, true);
  for (const p of system.planets) drawOrbit(buf, p.orbit, scale, cx, cy, ORBIT);

  // Belts: a ring of specks that turns rigidly with the orbital period at its middle, plus a
  // few asteroids drawn by their generator.
  for (const b of system.belts) {
    const rng = new Rng(derive(b.seed, 'specks'));
    const mid = (b.inner + b.outer) / 2;
    const period = periodTicks(mid, system.mass);
    const turn = (TAU * (((tick % period) + period) % period)) / period;
    const ramp = b.material === 'icy' ? 'ice' : b.material === 'metallic' ? 'metal-light' : 'rock';
    const n = Math.round((scale.px(b.outer) - scale.px(b.inner) + 2) * (big ? 60 : 40));
    for (let i = 0; i < n; i++) {
      const r = rng.range(b.inner, b.outer);
      const a = rng.range(0, TAU) + turn;
      const [x, y] = scale.point(r * cos(a), r * sin(a), cx, cy);
      buf.set(Math.floor(x), Math.floor(y), palette.index(ramp, rng.int(0, 2)));
    }
    const rocks = big ? 5 : 3;
    for (let i = 0; i < rocks; i++) {
      const r = rng.range(b.inner, b.outer);
      const a = rng.range(0, TAU) + turn;
      const [x, y] = scale.point(r * cos(a), r * sin(a), cx, cy);
      const material = b.material === 'icy' ? 'icy' : b.material === 'metallic' ? 'metallic' : 'rocky';
      const rock = registry.run('asteroid', { material }, derive(b.seed, 'rock', i), { size: big ? 8 : 6, frame, lightDir: lightFrom(cx, cy, x, y) });
      place(buf, rock, x, y);
    }
  }

  // Stars: the close pair around the centre (separation exaggerated), the distant third at the
  // edge along its true direction.
  system.stars.forEach((s, k) => {
    let x = cx;
    let y = cy;
    const pos = starPosition(s, tick);
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    if (k < 2 && r > 0) {
      x += (pos.x / r) * pairOffset;
      y += (pos.y / r) * pairOffset;
    } else if (k === 2) {
      const d = Math.min(W / 2 - 14, scale.px(r));
      x += (pos.x / r) * d;
      y += (pos.y / r) * d;
    }
    const star = registry.run('star', s.recipe, s.seed, { size: k === 2 ? 12 : starSize(big), frame: rotationFrame(s.rotation, frame) });
    place(buf, star, x, y);
  });

  // Comets: an icy nucleus with a tail pointing away from the centre, longer near periapsis.
  for (const c of system.comets) {
    const pos = orbitPosition(c.orbit, tick);
    const [x, y] = scale.point(pos.x, pos.y, cx, cy);
    const r = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
    const q = c.orbit.a * (1 - c.orbit.e);
    const len = Math.round(Math.min(big ? 26 : 18, Math.max(3, (big ? 26 : 18) * (q / r) * 1.5)));
    const ux = (x - cx) / Math.max(1, Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)));
    const uy = (y - cy) / Math.max(1, Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)));
    for (let i = len; i >= 1; i--) {
      const t = i / len;
      const tone = t < 0.3 ? 2 : t < 0.6 ? 1 : 0;
      const tx = Math.round(x + ux * i);
      const ty = Math.round(y + uy * i);
      if (t > 0.6 && bayerThreshold(BAYER4, tx, ty) > 1.4 - t) continue;
      buf.set(tx, ty, palette.index('energy', tone));
      if (t < 0.5) buf.set(tx + (Math.abs(uy) > Math.abs(ux) ? 1 : 0), ty + (Math.abs(uy) > Math.abs(ux) ? 0 : 1), palette.index('gas-cold', 2));
    }
    const nucleus = registry.run('asteroid', { material: 'icy' }, derive(c.seed, 'nucleus'), { size: 6, frame, lightDir: lightFrom(cx, cy, x, y) });
    place(buf, nucleus, x, y);
  }

  // Planets, lit from the centre, with their moons as small shaded dots.
  for (const p of system.planets) {
    const pos = orbitPosition(p.orbit, tick);
    const [x, y] = scale.point(pos.x, pos.y, cx, cy);
    const light = lightFrom(cx, cy, x, y);
    const size = planetSize(p, big);
    const r = registry.run('planet', p.recipe, p.look, { size, frame: rotationFrame(p.rotation, frame), ...(light ? { lightDir: light } : {}) });
    place(buf, r, x, y);
    p.moons.forEach((m, k) => {
      const mp = orbitPosition(m.orbit, tick);
      const len = Math.sqrt(mp.x * mp.x + mp.y * mp.y) || 1;
      const d = size / 2 + 3 + 2 * k;
      const mx = Math.round(x + (mp.x / len) * d);
      const my = Math.round(y + (mp.y / len) * d);
      const [ramp, lit, dark] = MOON_TONES[m.archetype];
      buf.set(mx, my, palette.index(ramp, lit));
      // One shadow pixel on the side away from the star.
      const sx = mx - cx;
      const sy = my - cy;
      if (Math.abs(sx) > Math.abs(sy)) buf.set(mx + Math.sign(sx), my, palette.index(ramp, dark));
      else buf.set(mx, my + Math.sign(sy), palette.index(ramp, dark));
    });
    if (o.labels === true && big) drawText(buf, p.name.slice(p.name.lastIndexOf(' ') + 1), Math.round(x + size / 2 - 1), Math.round(y - size / 2 - 3), LABEL);
  }

  if (o.labels === true) {
    drawText(buf, system.name, 3, 3, TITLE);
    drawText(buf, system.code, 3 + textWidth(system.name) + 4, 3, TEXT);
    drawText(buf, system.stars.map((s) => s.label).join(' + '), 3, 3 + LINE_HEIGHT, TEXT);
    const t = `T ${tick}`;
    drawText(buf, t, W - 3 - textWidth(t), W - 3 - 5, TEXT);
  }
  return buf;
}
