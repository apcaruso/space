// The world layer of the explorer: galaxy glow, systems as dots from the catalogue, and the
// systems near the camera in detail (orbits, stars, planets, moons, belts, comets) with their
// sprites at size steps. Returns the hit targets for hover and selection.

import { IndexedBuffer } from '../core/buffer';
import { cos, LN2, log, sin, TAU } from '../core/dmath';
import { derive } from '../core/hash';
import { Rng } from '../core/rng';
import { STAR_COLOURS } from '../gen/maps/galaxy';
import { registry } from '../gen/index';
import { starClass } from '../gen/star/classes';
import { masterPalette } from '../toolkit/palette';
import type { Address } from '../universe/address';
import { backgroundRegion, type Galaxy } from '../universe/galaxy';
import { STAR_CLASS_IDS } from '../universe/stars';
import { generateSystem, rotationFrame, type StarSystem } from '../universe/system';
import { SCREEN_H, SCREEN_W, type Projection } from './camera';
import type { Catalogue } from './catalogue';
import { blit, circle, disc, keep, line } from './draw';
import { SYSTEM_RADIUS, SystemGeometry, type Offset } from './geometry';
import { Haze } from './haze';
import { lightBin, objectKey, type Sprite, type SpriteRequest, type SpriteSource } from './sprites';
import { stepSize } from './steps';

const palette = masterPalette();
export const SPACE = palette.index('space', 0);
const ORBIT = palette.index('space', 2);
const ORBIT_LIT = palette.index('ui-cool', 1);
const COMET_PATH = palette.index('gas-cold', 0);

export type TransitionMode = 'cut' | 'dither';
/** Frames of the dithered dissolve between two size steps. */
export const FADE_FRAMES = 6;

/** Above this scale (pixels per sector) systems near the camera are drawn in detail. */
export const S_DETAIL = 300;
/** Below this scale systems are summed per pixel, like the galaxy map. */
const S_SUMMED = 3;
/** New systems generated per frame; the others stay dots until their turn. */
const SYSTEMS_PER_FRAME = 6;
/** Minimum on-screen diameters for sprites; smaller bodies are dots. */
const MIN_PLANET = 8;
const MIN_STAR_DISC = 5;

export interface Target {
  readonly address: Address;
  readonly kind: 'system' | 'star' | 'planet' | 'moon' | 'belt' | 'comet';
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface WorldFrame {
  readonly proj: Projection;
  readonly tick: number;
  /** Decorative animation frame (12 per second), independent of the simulation speed. */
  readonly anim: number;
  /** Rendered frame number, for transitions. */
  readonly frameNo: number;
  /** +1 zooming in, -1 zooming out, 0 still: which neighbouring step to prefetch. */
  readonly zoomDir: number;
  /** Address string of the selected body, to highlight its orbit. */
  readonly selected?: string;
}

export interface WorldStats {
  dots: number;
  detailed: number;
  sprites: number;
  placeholders: number;
  hazeSamples: number;
  /** Smallest and largest size step of the sprites drawn (0 when none). */
  minStep: number;
  maxStep: number;
}

interface Detailed {
  readonly system: StarSystem;
  readonly geometry: SystemGeometry;
}

interface Transition {
  shown: number;
  prev: number;
  start: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const classIndex = (cls: string) => STAR_CLASS_IDS.indexOf(cls);
const RED_GIANT = classIndex('red-giant');
const classColour = STAR_CLASS_IDS.map((id) => {
  const [ramp, tones] = STAR_COLOURS[id];
  return tones.map((t) => palette.index(ramp, t));
});

/** Map colour of a planet or moon seen as a dot: [lit, shadow]. */
const DOT_COLOURS: Readonly<Record<string, readonly [number, number]>> = {
  terran: [palette.index('ocean', 3), palette.index('vegetation', 1)],
  ocean: [palette.index('ocean', 3), palette.index('ocean', 1)],
  desert: [palette.index('sand', 2), palette.index('sand', 0)],
  ice: [palette.index('ice', 3), palette.index('ice', 1)],
  lava: [palette.index('magma', 3), palette.index('magma', 0)],
  toxic: [palette.index('vegetation', 4), palette.index('vegetation', 1)],
  gas: [palette.index('gas-warm', 3), palette.index('gas-warm', 1)],
  cratered: [palette.index('rock', 3), palette.index('rock', 1)],
  dead: [palette.index('ash', 2), palette.index('ash', 0)],
};

const sizes = (gen: string) => registry.get(gen).sizes;

/**
 * Animation frame of a star: its loop repeats, so every frame can stay cached. Big stars cost
 * more to generate and to keep, so they animate with fewer, slower frames.
 */
function starFrame(anim: number, size: number): number {
  const [div, step] = size <= 64 ? [2, 1] : size <= 128 ? [3, 2] : [4, 4];
  return (Math.floor(anim / div) * step) % 96;
}

/** Is a body of diameter d (plus halo or rings) centred at (X, Y) outside the screen? */
function offscreen(X: number, Y: number, d: number): boolean {
  const r = d * 1.6 + 8;
  return X + r < 0 || Y + r < 0 || X - r > SCREEN_W || Y - r > SCREEN_H;
}

export class World {
  readonly galaxy: Galaxy;
  readonly catalogue: Catalogue;
  readonly haze: Haze;
  transition: TransitionMode = 'cut';
  /** Glow samples computed per frame; the rest are interpolated from coarser grids for now. */
  hazeBudget = 900;
  /** New full systems per frame; the others stay dots until their turn. */
  systemBudget = SYSTEMS_PER_FRAME;
  private readonly systems = new Map<string, Detailed>();
  private readonly transitions = new Map<string, Transition>();
  private readonly sumCount = new Uint16Array(SCREEN_W * SCREEN_H);
  private readonly sumLum = new Float32Array(SCREEN_W * SCREEN_H);
  private readonly sumCls = new Uint8Array(SCREEN_W * SCREEN_H);
  private stats: WorldStats = { dots: 0, detailed: 0, sprites: 0, placeholders: 0, hazeSamples: 0, minStep: 0, maxStep: 0 };
  private generatedThisFrame = 0;

  constructor(galaxy: Galaxy, catalogue: Catalogue) {
    this.galaxy = galaxy;
    this.catalogue = catalogue;
    this.haze = new Haze(galaxy);
  }

  /** Full system (cached), generated now regardless of the per-frame budget. */
  system(sx: number, sy: number, i: number): Detailed {
    const key = `${sx},${sy},${i}`;
    let d = this.systems.get(key);
    if (d === undefined) {
      const system = generateSystem(this.galaxy, sx, sy, i);
      d = { system, geometry: new SystemGeometry(system) };
      this.systems.set(key, d);
      if (this.systems.size > 96) this.systems.delete(this.systems.keys().next().value as string);
    } else {
      this.systems.delete(key);
      this.systems.set(key, d);
    }
    return d;
  }

  private systemIfAffordable(sx: number, sy: number, i: number): Detailed | undefined {
    const key = `${sx},${sy},${i}`;
    if (this.systems.has(key)) return this.system(sx, sy, i);
    if (this.generatedThisFrame >= this.systemBudget) return undefined;
    this.generatedThisFrame++;
    return this.system(sx, sy, i);
  }

  render(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource): { targets: Target[]; stats: WorldStats } {
    this.stats = { dots: 0, detailed: 0, sprites: 0, placeholders: 0, hazeSamples: 0, minStep: 0, maxStep: 0 };
    this.generatedThisFrame = 0;
    const targets: Target[] = [];
    const s = f.proj.s;
    fb.fill(SPACE);

    // Inside systems only: in regions the stars on screen are the real systems.
    if (s >= 500) this.backdrop(fb, f, sprites, smoothstep(log(500), log(2000), log(s)));
    const hazeAlpha = 1 - smoothstep(log(300), log(1500), log(s));
    // The glow dims as the zoom grows: at region scale it is a hint of the arm, not a veil.
    const gain = s <= 1 ? 1 : Math.max(0.16, 1 - (0.16 * log(s)) / LN2);
    this.haze.render(fb, f.proj, { gain, alpha: hazeAlpha, budget: this.hazeBudget, background: SPACE });
    this.stats.hazeSamples = this.haze.computed;

    if (s < S_DETAIL) this.dots(fb, f, targets);
    else this.detail(fb, f, sprites, targets);
    return { targets, stats: this.stats };
  }

  /** Star field and nebulae of the sector, far away and still, inside systems. */
  private backdrop(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, alpha: number): void {
    const c = f.proj.camera.center;
    const info = this.galaxy.sector(c.sx, c.sy);
    const region = backgroundRegion(info);
    // Quantised, so moving inside a sector never changes the recipe.
    const q = (v: number, k: number) => Math.round(v * k) / k;
    // Nebulae a little fainter than in a standalone backdrop: here they sit behind orbits.
    const recipe = { layer: 'all', region: { ...region, stars: q(region.stars as number, 2), nebula: q((region.nebula as number) * 0.6, 5), galaxies: q(region.galaxies as number, 2) } };
    const size = 256;
    // Parallax: the backdrop moves 64 px per sector, so it is still inside a system.
    const ox = Math.floor((c.sx + c.x) * 64) - SCREEN_W / 2;
    const oy = Math.floor((c.sy + c.y) * 64) - SCREEN_H / 2;
    for (let cy = Math.floor(oy / size); cy * size < oy + SCREEN_H; cy++) {
      for (let cx = Math.floor(ox / size); cx * size < ox + SCREEN_W; cx++) {
        const req: SpriteRequest = { gen: 'background', recipe: { ...recipe, chunk: { x: cx, y: cy } }, seed: this.galaxy.seed, size, frame: 0, light: -1 };
        const chunk = sprites.get(req, 0);
        if (chunk !== undefined) blit(fb, chunk.buffer, cx * size - ox, cy * size - oy, alpha);
      }
    }
  }

  /** Systems as pixels: summed per pixel at galaxy scale, one by one in regions. */
  private dots(fb: IndexedBuffer, f: WorldFrame, targets: Target[]): void {
    const proj = f.proj;
    const s = proj.s;
    const b = proj.bounds(2);
    if (s < S_SUMMED) {
      const count = this.sumCount;
      const lum = this.sumLum;
      const cls = this.sumCls;
      count.fill(0);
      lum.fill(0);
      this.catalogue.visit(b.x0, b.y0, b.x1, b.y1, (sx, sy, _i, x, y, c, l0) => {
        const X = proj.px(sx, x);
        const Y = proj.py(sy, y);
        if (X < 0 || Y < 0 || X >= SCREEN_W || Y >= SCREEN_H) return;
        const k = Y * SCREEN_W + X;
        count[k]++;
        // Giants are everywhere in an old population: as beacons they would only add noise.
        const l = c === RED_GIANT ? Math.min(l0, 1) : l0;
        if (l > lum[k]) {
          lum[k] = l;
          cls[k] = c;
        }
      });
      // Limit of magnitude: faint stars appear as the zoom grows, dense areas always show.
      const lMin = 5 / (s * s * s);
      const cMin = Math.max(1, 4 / (s * s));
      const area = 1 / (s * s);
      for (let k = 0; k < count.length; k++) {
        const n = count[k];
        if (n === 0) continue;
        if (n < cMin && lum[k] < lMin) continue;
        const density = n / area;
        const tone = s >= 2 ? (lum[k] >= 0.5 ? 2 : 1) : density <= 4 ? 0 : density <= 9 ? 1 : 2;
        fb.data[k] = classColour[cls[k]][tone];
        this.stats.dots++;
      }
      return;
    }
    const cross = s >= 6;
    const pair = s >= 12;
    // From a few dozen pixels per sector every system is a small star, not just the bright ones.
    const allCross = s >= 48;
    // The limit of magnitude goes on falling: faint red dwarfs appear only in close regions.
    const lMin = s >= 16 ? 0 : 5 / (s * s * s);
    this.catalogue.visit(b.x0, b.y0, b.x1, b.y1, (sx, sy, i, x, y, c, l, stars, comp) => {
      if (l < lMin) return;
      const X = proj.px(sx, x);
      const Y = proj.py(sy, y);
      if (X < -2 || Y < -2 || X >= SCREEN_W + 2 || Y >= SCREEN_H + 2) return;
      this.drawStarDot(fb, X, Y, allCross ? Math.max(l, 5) : l, c, cross, pair && stars > 1 ? comp : 255, 1, l);
      this.stats.dots++;
      if (s >= 24) targets.push({ address: { galaxy: this.galaxy.seed, sector: { sx, sy }, system: i }, kind: 'system', x: X, y: Y, r: 2 });
    });
  }

  /** A system as a pixel, or a small cross when bright (`glow` decides the cross, `l` the tone). */
  private drawStarDot(fb: IndexedBuffer, X: number, Y: number, glow: number, c: number, cross: boolean, companion: number, alpha: number, l = glow): void {
    const bright = glow >= 5 || STAR_CLASS_IDS[c] === 'red-giant';
    const colours = classColour[c];
    if (cross && bright) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) if (keep(X + dx, Y + dy, alpha)) fb.set(X + dx, Y + dy, colours[0]);
    }
    if (keep(X, Y, alpha)) fb.set(X, Y, colours[l >= 0.5 ? 2 : 1]);
    if (companion !== 255 && keep(X + 1, Y + 1, alpha)) fb.set(X + (cross && bright ? 2 : 1), Y + (cross && bright ? 0 : 1), classColour[companion][1]);
  }

  /** Systems near the camera from their full data. */
  private detail(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, targets: Target[]): void {
    const proj = f.proj;
    const s = proj.s;
    const margin = SYSTEM_RADIUS * 1.3 * s;
    const b = proj.bounds(Math.min(margin, 1e6));
    const found: [number, number, number, number, number, number, number, number][] = [];
    this.catalogue.visit(b.x0, b.y0, b.x1, b.y1, (sx, sy, i, x, y, c, l, stars, comp) => found.push([sx, sy, i, x, y, c, l, stars * 256 + comp]));
    // Nearest to the centre first, so the budget goes where the user looks.
    const cx = SCREEN_W / 2;
    const cy = SCREEN_H / 2;
    found.sort((a, b2) => {
      const da = Math.abs(proj.x(a[0], a[3]) - cx) + Math.abs(proj.y(a[1], a[4]) - cy);
      const db = Math.abs(proj.x(b2[0], b2[3]) - cx) + Math.abs(proj.y(b2[1], b2[4]) - cy);
      return da - db;
    });
    for (const [sx, sy, i, x, y, c, l, packed] of found) {
      const det = this.systemIfAffordable(sx, sy, i);
      if (det === undefined) {
        this.drawStarDot(fb, proj.px(sx, x), proj.py(sy, y), Math.max(l, 5), c, true, packed & 255, 1, l);
        continue;
      }
      this.stats.detailed++;
      this.drawSystem(fb, f, sprites, det, targets);
    }
  }

  private drawSystem(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, det: Detailed, targets: Target[]): void {
    const { system: sys, geometry: g } = det;
    const proj = f.proj;
    const s = proj.s;
    const px = sys.position;
    const at = (o: Offset): [number, number] => [proj.x(px.sx, px.x, o.dx), proj.y(px.sy, px.y, o.dy)];
    const [cx, cy] = at({ dx: 0, dy: 0 });
    const rPx = SYSTEM_RADIUS * s;
    const base: Address = { galaxy: sys.galaxy, sector: { sx: sys.sx, sy: sys.sy }, system: sys.index };
    targets.push({ address: base, kind: 'system', x: cx, y: cy, r: Math.max(3, Math.min(rPx, 12)) });

    const orbitAlpha = smoothstep(40, 90, rPx);
    if (orbitAlpha > 0) {
      sys.comets.forEach((c) => this.curve(fb, (t) => at(this.pointOnOrbit(g, c.orbit, t)), COMET_PATH, 2, orbitAlpha));
      sys.planets.forEach((p) => {
        const prefix = addressPrefix(base, p.index);
        const selected = f.selected !== undefined && (f.selected === prefix || f.selected.startsWith(`${prefix}m`));
        this.curve(fb, (t) => at(this.pointOnOrbit(g, p.orbit, t)), selected ? ORBIT_LIT : ORBIT, 0, orbitAlpha);
      });
      sys.belts.forEach((belt, k) => this.belt(fb, f, sprites, det, k, at, orbitAlpha, targets, base));
    }

    // Stars.
    sys.stars.forEach((star, k) => {
      const o = g.star(k, f.tick);
      const [X, Y] = at(o);
      const cls = starClass(star.class);
      const d = 2 * g.starRadius[k] * s;
      if (offscreen(X, Y, Math.max(d, 24) * 2)) return;
      targets.push({ address: { ...base, body: { kind: 'star', index: k } }, kind: 'star', x: X, y: Y, r: Math.max(3, d / 2) });
      // Stars are animated sprites as soon as the system is drawn in detail: at least the
      // generator's smallest size, growing with the zoom once the true disc is larger.
      void MIN_STAR_DISC;
      const lim = sizes('star');
      const want = Math.min(lim.max, Math.max(k === 2 ? lim.min : lim.min + 2, d / cls.scale));
      this.sprite(fb, f, sprites, { gen: 'star', recipe: star.recipe, seed: star.seed, frame: starFrame(f.anim, want), light: -1 }, want, X, Y, 1, classColour[classIndex(star.class)][2]);
    });

    if (orbitAlpha <= 0) return;

    // Comets: an icy nucleus and a tail pointing away from the centre.
    sys.comets.forEach((c, k) => {
      const o = g.comet(k, f.tick);
      const [X, Y] = at(o);
      if (offscreen(X, Y, 64)) return;
      const r = Math.sqrt(o.dx * o.dx + o.dy * o.dy) || 1;
      const q = g.scale.world(c.orbit.a * (1 - c.orbit.e));
      const len = SYSTEM_RADIUS * 0.12 * s * Math.min(1, Math.max(0.15, (q / r) * 1.2));
      this.tail(fb, X, Y, o.dx / r, o.dy / r, len, orbitAlpha);
      const d = 2 * 0.00035 * s;
      if (d < 6) {
        if (keep(Math.floor(X), Math.floor(Y), orbitAlpha)) fb.set(Math.floor(X), Math.floor(Y), palette.index('ice', 3));
      } else {
        this.sprite(fb, f, sprites, { gen: 'asteroid', recipe: { material: 'icy' }, seed: c.seed, frame: f.anim % 96, light: lightBin(cx - X, cy - Y) }, d, X, Y, orbitAlpha, palette.index('ice', 3));
      }
      targets.push({ address: { ...base, body: { kind: 'comet', index: k } }, kind: 'comet', x: X, y: Y, r: 4 });
    });

    // Planets and moons, lit from the centre of the system.
    sys.planets.forEach((p, n) => {
      const o = g.planet(n, f.tick);
      const [X, Y] = at(o);
      const d = 2 * g.planetRadius[n] * s;
      // Off screen, moons included: nothing to draw or generate.
      if (offscreen(X, Y, g.moonDistance[n].length > 0 ? 2 * (g.moonDistance[n][g.moonDistance[n].length - 1] * s + d) : d)) return;
      const address: Address = { ...base, body: { kind: 'planet', index: n } };
      targets.push({ address, kind: 'planet', x: X, y: Y, r: Math.max(3, d / 2) });
      const light = lightBin(cx - X, cy - Y);
      // When the system fills the view, planets are at least small sprites, not dots.
      const shown = rPx >= 70 ? Math.max(d, MIN_PLANET) : d;
      this.body(fb, f, sprites, p.recipe, p.look, rotationFrame(p.rotation, f.tick), light, p.archetype, shown, X, Y, orbitAlpha);
      if (d < 20) return;
      const moonAlpha = smoothstep(20, 36, d) * orbitAlpha;
      p.moons.forEach((m, k) => {
        const mo = g.moon(n, k, f.tick);
        const MX = X + mo.dx * s;
        const MY = Y + mo.dy * s;
        if (d >= 40) this.ring(fb, X, Y, g.moonDistance[n][k] * s, ORBIT, moonAlpha);
        const dm = 2 * g.moonRadius[n][k] * s;
        if (offscreen(MX, MY, dm)) return;
        targets.push({ address: { ...base, body: { kind: 'planet', index: n, moon: k } }, kind: 'moon', x: MX, y: MY, r: Math.max(3, dm / 2) });
        this.body(fb, f, sprites, m.recipe, m.look, rotationFrame(m.rotation, f.tick), lightBin(cx - MX, cy - MY), m.archetype, dm, MX, MY, moonAlpha);
      });
    });
  }

  private pointOnOrbit(g: SystemGeometry, o: StarSystem['planets'][number]['orbit'], t: number): Offset {
    const [dx, dy] = g.orbitPoint(o, t * TAU);
    return { dx, dy };
  }

  /** A planet or moon: a shaded dot when small, a sprite otherwise. */
  private body(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, recipe: Readonly<Record<string, unknown>>, look: number, frame: number, light: number, archetype: string, d: number, X: number, Y: number, alpha: number): void {
    const [lit, dark] = DOT_COLOURS[archetype];
    if (d < MIN_PLANET) {
      const x = Math.floor(X);
      const y = Math.floor(Y);
      if (keep(x, y, alpha)) fb.set(x, y, lit);
      if (d >= 3) {
        const a = (light / 32) * TAU;
        const sx = Math.round(-cos(a));
        const sy = Math.round(-sin(a));
        if (keep(x + sx, y + sy, alpha)) fb.set(x + sx, y + sy, dark);
        if (d >= 5 && keep(x - sx, y - sy, alpha)) fb.set(x - sx, y - sy, lit);
      }
      return;
    }
    this.sprite(fb, f, sprites, { gen: 'planet', recipe, seed: look, frame, light }, d, X, Y, alpha, lit);
  }

  /**
   * Draws the sprite of an object at the size step nearest to `want`, with the transition
   * between steps. While a sprite is not ready: the nearest ready step, else a small disc.
   */
  private sprite(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, base: Omit<SpriteRequest, 'size'>, want: number, X: number, Y: number, alpha: number, colour: number): void {
    const lim = sizes(base.gen);
    const size = stepSize(lim.min, lim.max, Math.min(lim.max, want));
    const req: SpriteRequest = { ...base, size };
    if (base.gen === 'planet' || base.gen === 'star') {
      this.stats.minStep = this.stats.minStep === 0 ? size : Math.min(this.stats.minStep, size);
      this.stats.maxStep = Math.max(this.stats.maxStep, size);
    }
    const key = objectKey(req);
    let tr = this.transitions.get(key);
    if (tr === undefined) {
      tr = { shown: size, prev: -1, start: -FADE_FRAMES };
      this.transitions.set(key, tr);
      if (this.transitions.size > 4096) this.transitions.delete(this.transitions.keys().next().value as string);
    }
    let sprite = sprites.get(req, 1);
    if (tr.shown !== size && sprite !== undefined) {
      tr.prev = tr.shown;
      tr.shown = size;
      tr.start = f.frameNo;
    }
    if (f.zoomDir !== 0) {
      // Prefetch the neighbouring step in the zoom direction.
      const next = stepSize(lim.min, lim.max, Math.min(lim.max, Math.max(lim.min, size * (f.zoomDir > 0 ? 1.25 : 0.8))));
      if (next !== size) sprites.prefetch({ ...base, size: next });
    }
    if (sprite === undefined) sprite = sprites.get({ ...base, size: tr.shown }) ?? sprites.nearest(req);
    if (sprite === undefined) {
      this.stats.placeholders++;
      const r = Math.min(2, Math.max(1, want / 8));
      disc(fb, X, Y, r, colour);
      return;
    }
    this.stats.sprites++;
    const x0 = Math.round(X - sprite.cx);
    const y0 = Math.round(Y - sprite.cy);
    const fading = this.transition === 'dither' && tr.prev >= 0 && f.frameNo - tr.start < FADE_FRAMES;
    if (fading) {
      const p = (f.frameNo - tr.start + 1) / (FADE_FRAMES + 1);
      const old: Sprite | undefined = sprites.get({ ...base, size: tr.prev });
      if (old !== undefined) blit(fb, old.buffer, Math.round(X - old.cx), Math.round(Y - old.cy), p * alpha, true);
      blit(fb, sprite.buffer, x0, y0, p * alpha);
      return;
    }
    blit(fb, sprite.buffer, x0, y0, alpha);
  }

  private belt(fb: IndexedBuffer, f: WorldFrame, sprites: SpriteSource, det: Detailed, k: number, at: (o: Offset) => [number, number], alpha: number, targets: Target[], base: Address): void {
    const { system: sys, geometry: g } = det;
    const belt = sys.belts[k];
    const { inner, outer } = g.belts[k];
    const turn = g.beltAngle(k, f.tick);
    const rng = new Rng(derive(belt.seed, 'specks'));
    const ramp = belt.material === 'icy' ? 'ice' : belt.material === 'metallic' ? 'metal-light' : 'rock';
    const tones = palette.ramp(ramp).indices;
    const s = f.proj.s;
    const n = Math.round(Math.min(1400, Math.max(120, (outer - inner) * s * 40)));
    for (let i = 0; i < n; i++) {
      const r = rng.range(inner, outer);
      const a = rng.range(0, TAU) + turn;
      const tone = rng.int(0, 2);
      const [X, Y] = at({ dx: r * cos(a), dy: r * sin(a) });
      const x = Math.floor(X);
      const y = Math.floor(Y);
      if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H || !keep(x, y, alpha)) continue;
      fb.set(x, y, tones[tone]);
    }
    const material = belt.material === 'icy' ? 'icy' : belt.material === 'metallic' ? 'metallic' : 'rocky';
    const rocks = new Rng(derive(belt.seed, 'rocks'));
    const [cx, cy] = at({ dx: 0, dy: 0 });
    const mid = (inner + outer) / 2;
    for (let i = 0; i < 5; i++) {
      const r = rocks.range(inner, outer);
      const a = rocks.range(0, TAU) + turn;
      const [X, Y] = at({ dx: r * cos(a), dy: r * sin(a) });
      const d = 2 * 0.0004 * s * rocks.range(0.6, 1.4);
      if (X < -d || Y < -d || X > SCREEN_W + d || Y > SCREEN_H + d) continue;
      if (d < 6) continue;
      this.sprite(fb, f, sprites, { gen: 'asteroid', recipe: { material }, seed: derive(belt.seed, 'rock', i), frame: f.anim % 96, light: lightBin(cx - X, cy - Y) }, d, X, Y, alpha, tones[2]);
    }
    const [bx, by] = at({ dx: mid, dy: 0 });
    targets.push({ address: { ...base, body: { kind: 'belt', index: k } }, kind: 'belt', x: bx, y: by, r: 4 });
  }

  /** A comet's tail: bright near the nucleus, dithered away at the end. */
  private tail(fb: IndexedBuffer, X: number, Y: number, ux: number, uy: number, len: number, alpha: number): void {
    const n = Math.round(Math.min(len, 60));
    for (let i = n; i >= 1; i--) {
      const t = i / n;
      const x = Math.round(X + ux * i);
      const y = Math.round(Y + uy * i);
      if (t > 0.55 && !keep(x, y, 1.4 - t)) continue;
      if (!keep(x, y, alpha)) continue;
      fb.set(x, y, palette.index('energy', t < 0.3 ? 2 : t < 0.6 ? 1 : 0));
      if (t < 0.5) {
        const side = Math.abs(uy) > Math.abs(ux);
        fb.set(x + (side ? 1 : 0), y + (side ? 0 : 1), palette.index('gas-cold', 2));
      }
    }
  }

  /** A closed curve through world points, sampled finer where it crosses the screen. */
  private curve(fb: IndexedBuffer, point: (t: number) => [number, number], colour: number, dotted: number, alpha: number): void {
    const coarse = 96;
    let prev = point(0);
    for (let i = 1; i <= coarse; i++) {
      const next = point(i / coarse);
      this.segment(fb, point, (i - 1) / coarse, i / coarse, prev, next, colour, dotted, alpha, 0);
      prev = next;
    }
  }

  private segment(fb: IndexedBuffer, point: (t: number) => [number, number], t0: number, t1: number, a: [number, number], b: [number, number], colour: number, dotted: number, alpha: number, depth: number): void {
    const m = 8;
    if ((a[0] < -m && b[0] < -m) || (a[1] < -m && b[1] < -m) || (a[0] > SCREEN_W + m && b[0] > SCREEN_W + m) || (a[1] > SCREEN_H + m && b[1] > SCREEN_H + m)) {
      // Off screen, unless a long chord hides a bulge that comes back: split those.
      const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (len < 64 || depth > 12) return;
    }
    const len = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (len > 6 && depth < 14) {
      const tm = (t0 + t1) / 2;
      const mid = point(tm);
      this.segment(fb, point, t0, tm, a, mid, colour, dotted, alpha, depth + 1);
      this.segment(fb, point, tm, t1, mid, b, colour, dotted, alpha, depth + 1);
      return;
    }
    if (alpha >= 1) {
      line(fb, a[0], a[1], b[0], b[1], colour, dotted);
      return;
    }
    lineAlpha(fb, a[0], a[1], b[0], b[1], colour, dotted, alpha);
  }

  private ring(fb: IndexedBuffer, X: number, Y: number, r: number, colour: number, alpha: number): void {
    if (r > 4000) return;
    if (alpha >= 1) {
      circle(fb, X, Y, r, colour, true);
      return;
    }
    const steps = Math.max(16, Math.round(r * 2));
    for (let i = 0; i < steps; i += 2) {
      const a = (TAU * i) / steps;
      const x = Math.round(X + r * cos(a));
      const y = Math.round(Y + r * sin(a));
      if (keep(x, y, alpha)) fb.set(x, y, colour);
    }
  }
}

function lineAlpha(buf: IndexedBuffer, x0: number, y0: number, x1: number, y1: number, index: number, dotted: number, alpha: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  const mask = dotted === 0 ? 0 : dotted === 1 ? 1 : 3;
  let err = dx + dy;
  for (;;) {
    if (((x + y) & mask) === 0 && keep(x, y, alpha)) buf.set(x, y, index);
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

/** Address prefix of a planet (its moons share it). */
function addressPrefix(base: Address, planet: number): string {
  return `${base.galaxy.toString(36)}.${(base.sector as { sx: number }).sx.toString(36)}.${(base.sector as { sy: number }).sy.toString(36)}.${(base.system as number).toString(36)}.p${planet}`;
}
