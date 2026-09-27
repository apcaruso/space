// The interface drawn over the world: breadcrumb, clock, card of the selection, hover label,
// search, surface map with legend, help line and debug overlay. Returns the clickable regions.

import type { IndexedBuffer } from '../../core/buffer';
import { drawText, fitText, LARGE, SMALL, textWidth } from '../../toolkit/font';
import { masterPalette } from '../../toolkit/palette';
import type { Address } from '../../universe/address';
import { formatAddress } from '../../universe/address';
import { SCREEN_H, SCREEN_W, type Projection } from '../camera';
import { blit, circle, keep, rect } from '../draw';
import type { Explorer } from '../explorer';
import { SPEEDS } from '../clock';
import { dateOf, MATERIAL_NAMES } from '../info';
import { LEVEL_NAMES, levelAt } from '../places';
import type { SpriteSource } from '../sprites';
import { stepSize } from '../steps';
import { icon, type IconName } from './icons';
import { GLASS, panel, PANEL, PANEL_WARM } from './panel';

const palette = masterPalette();
const INK = palette.index('ui-cool', 3);
const TEXT = palette.index('ui-cool', 2);
const DIM = palette.index('ui-cool', 1);
const WARM = palette.index('ui-warm', 3);
const WARM_DIM = palette.index('ui-warm', 2);
const SHADOW = palette.index('space', 0);

export interface HudHit {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly action: 'crumb' | 'pause' | 'faster' | 'close' | 'goto' | 'result';
  readonly address?: Address;
}

export function hudHit(hits: readonly HudHit[], x: number, y: number): HudHit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
  }
  return null;
}

/** Text with a 1 px dark shadow, readable over any part of the world. */
function say(fb: IndexedBuffer, text: string, x: number, y: number, colour: number, font = SMALL): void {
  drawText(fb, text, x + 1, y + 1, SHADOW, font);
  drawText(fb, text, x, y, colour, font);
}

interface Crumb {
  readonly label: string;
  readonly icon: IconName;
  readonly address: Address;
}

function crumbs(e: Explorer, a: Address): Crumb[] {
  const out: Crumb[] = [{ label: `Galassia ${e.galaxy.seed}`, icon: 'galaxy', address: { galaxy: a.galaxy } }];
  if (a.sector === undefined) return out;
  const sector = { galaxy: a.galaxy, sector: a.sector };
  out.push({ label: `settore ${a.sector.sx},${a.sector.sy}`, icon: 'sector', address: sector });
  if (a.system === undefined) return out;
  const sys = e.world.system(a.sector.sx, a.sector.sy, a.system).system;
  const sysAddr = { ...sector, system: a.system };
  out.push({ label: sys.name, icon: 'system', address: sysAddr });
  const b = a.body;
  if (b === undefined) return out;
  switch (b.kind) {
    case 'star':
      out.push({ label: sys.stars[b.index].label, icon: 'star', address: a });
      break;
    case 'belt':
      out.push({ label: sys.belts[b.index].name.replace(`${sys.code} `, ''), icon: 'belt', address: a });
      break;
    case 'comet':
      out.push({ label: sys.comets[b.index].name, icon: 'comet', address: a });
      break;
    default: {
      const p = sys.planets[b.index];
      out.push({ label: p.properName ?? p.name, icon: 'planet', address: { ...sysAddr, body: { kind: 'planet', index: b.index } } });
      if (b.moon !== undefined) out.push({ label: p.moons[b.moon].name.slice(p.name.length + 1), icon: 'moon', address: a });
    }
  }
  return out;
}

export function drawHud(fb: IndexedBuffer, e: Explorer, proj: Projection, sprites: SpriteSource): HudHit[] {
  const hits: HudHit[] = [];
  if (e.surface !== null) surfaceView(fb, e, sprites);

  // Rings: hover (dotted) and selection.
  const selected = e.selected === null ? null : formatAddress(e.selected);
  if (e.surface === null || e.surface.alpha < 1) {
    for (const t of e.targets) {
      if (selected !== null && formatAddress(t.address) === selected) circle(fb, t.x - 0.5, t.y - 0.5, t.r + 3, WARM, true);
    }
    if (e.hover !== null) circle(fb, e.hover.x - 0.5, e.hover.y - 0.5, e.hover.r + 2, TEXT, true);
  }

  // Breadcrumb.
  const where = e.selected ?? e.context();
  let x = 4;
  crumbs(e, where).forEach((c, i) => {
    if (i > 0) {
      say(fb, '›', x, 5, DIM);
      x += 6;
    }
    blit(fb, icon(c.icon, 8, i === 0 ? INK : TEXT, DIM), x, 4);
    x += 10;
    const label = fitText(c.label, 90);
    say(fb, label, x, 5, i === 0 ? INK : TEXT);
    hits.push({ x: x - 10, y: 3, w: textWidth(label, SMALL) + 12, h: 10, action: 'crumb', address: c.address });
    x += textWidth(label, SMALL) + 5;
  });

  // Clock: date, speed, pause.
  const date = dateOf(e.tick);
  const speed = `×${SPEEDS[e.speed]}`;
  const right = SCREEN_W - 4;
  blit(fb, icon(e.paused ? 'play' : 'pause', 8, e.paused ? WARM : INK, DIM), right - 8, 4);
  hits.push({ x: right - 10, y: 2, w: 12, h: 12, action: 'pause' });
  const sw = textWidth(speed, SMALL);
  say(fb, speed, right - 12 - sw, 5, e.paused ? DIM : WARM);
  hits.push({ x: right - 14 - sw, y: 2, w: sw + 4, h: 12, action: 'faster' });
  say(fb, date, right - 18 - sw - textWidth(date, SMALL), 5, TEXT);

  // Level and zoom, bottom left.
  const level = levelAt(e.place(where), e.camera.z);
  const levelText = `${LEVEL_NAMES[level]}`;
  if (e.catalogue.waiting.size === 0) say(fb, levelText, SCREEN_W - 4 - textWidth(levelText, SMALL), SCREEN_H - 9, DIM);

  // Card of the selection.
  const c = e.selectedCard();
  if (c !== null && (e.surface === null || e.surface.alpha < 1)) {
    const w = 160;
    const h = 40 + c.rows.length * 7;
    const px = SCREEN_W - w - 4;
    const py = 16;
    panel(fb, px, py, w, h);
    drawText(fb, fitText(c.title, w - 22, LARGE), px + 6, py + 6, INK, LARGE);
    drawText(fb, fitText(c.subtitle, w - 12), px + 6, py + 17, WARM_DIM, SMALL);
    blit(fb, icon('close', 8, TEXT, DIM), px + w - 13, py + 5);
    hits.push({ x: px + w - 15, y: py + 3, w: 12, h: 12, action: 'close' });
    c.rows.forEach(([k, v], i) => {
      const y = py + 27 + i * 7;
      drawText(fb, k, px + 6, y, DIM, SMALL);
      drawText(fb, fitText(v, w - 72), px + 66, y, TEXT, SMALL);
    });
    const fy = py + h - 10;
    drawText(fb, fitText(c.address, w - 40), px + 6, fy, DIM, SMALL);
    const go = 'vai ›';
    drawText(fb, go, px + w - 6 - textWidth(go, SMALL), fy, WARM, SMALL);
    hits.push({ x: px + w - 10 - textWidth(go, SMALL), y: fy - 2, w: textWidth(go, SMALL) + 6, h: 9, action: 'goto', address: e.selected ?? undefined });
  }

  // Hover label next to the cursor.
  if (e.hover !== null && !e.search.open && (e.surface === null || e.surface.alpha < 1)) {
    const label = hoverLabel(e, e.hover.address);
    if (label !== '') {
      const lw = textWidth(label, SMALL) + 8;
      const lx = Math.min(SCREEN_W - lw - 2, Math.max(2, Math.round(e.hover.x + e.hover.r + 6)));
      const ly = Math.min(SCREEN_H - 14, Math.max(14, Math.round(e.hover.y - 5)));
      panel(fb, lx, ly, lw, 12, PANEL);
      drawText(fb, label, lx + 4, ly + 3, INK, SMALL);
    }
  }

  if (e.search.open) search(fb, e, hits);

  // Help, messages, loading.
  if (e.help && !e.debug) {
    say(fb, 'trascina: muovi · rotella: zoom · clic: scegli · doppio clic: vai · / cerca · spazio · 1-5 · Esc · h', 4, SCREEN_H - 9, DIM);
  }
  if (e.messageVisible) {
    const w = textWidth(e.message, SMALL) + 10;
    panel(fb, (SCREEN_W - w) >> 1, SCREEN_H - 34, w, 13, PANEL_WARM);
    drawText(fb, e.message, ((SCREEN_W - w) >> 1) + 5, SCREEN_H - 30, WARM, SMALL);
  }
  if (e.catalogue.waiting.size > 0) {
    const t = `catalogo ${e.catalogue.loaded}/${e.catalogue.bands.length}`;
    say(fb, t, SCREEN_W - 4 - textWidth(t, SMALL), SCREEN_H - 9, DIM);
  }
  if (e.debug) debugOverlay(fb, e, proj);
  return hits;
}

function hoverLabel(e: Explorer, a: Address): string {
  if (a.system === undefined || a.sector === undefined) return '';
  const sys = e.world.system(a.sector.sx, a.sector.sy, a.system).system;
  const b = a.body;
  if (b === undefined) return `${sys.name} · ${sys.stars.map((s) => s.label).join(' + ')}`;
  switch (b.kind) {
    case 'star':
      return `${sys.stars[b.index].name} · ${sys.stars[b.index].label}`;
    case 'belt':
      return sys.belts[b.index].name;
    case 'comet':
      return sys.comets[b.index].name;
    default: {
      const p = sys.planets[b.index];
      if (b.moon !== undefined) return p.moons[b.moon].name;
      return p.properName === null ? p.name : `${p.properName} (${p.name})`;
    }
  }
}

function search(fb: IndexedBuffer, e: Explorer, hits: HudHit[]): void {
  const s = e.search;
  const w = 260;
  const rows = Math.min(8, s.results.length);
  const h = 34 + rows * 8;
  const x = (SCREEN_W - w) >> 1;
  const y = 30;
  panel(fb, x, y, w, h, PANEL_WARM);
  blit(fb, icon('search', 8, WARM, WARM_DIM), x + 6, y + 6);
  const caret = (e.anim >> 3) % 2 === 0 ? '_' : ' ';
  drawText(fb, fitText(s.text, w - 30) + caret, x + 18, y + 7, WARM, SMALL);
  rect(fb, x + 16, y + 15, w - 22, 1, WARM_DIM);
  drawText(fb, fitText(s.message, w - 12), x + 6, y + 19, DIM, SMALL);
  s.results.slice(0, rows).forEach((r, i) => {
    const ry = y + 29 + i * 8;
    if (i === s.index) rect(fb, x + 4, ry - 1, w - 8, 8, palette.index('space', 2));
    drawText(fb, fitText(r.label, w - 70), x + 8, ry, i === s.index ? WARM : TEXT, SMALL);
    drawText(fb, fitText(r.address, 58), x + w - 64, ry, DIM, SMALL);
    hits.push({ x: x + 4, y: ry - 1, w: w - 8, h: 8, action: 'result', address: parseResult(r.address) });
  });
}

function parseResult(text: string): Address | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) return undefined;
  const n = (t: string) => parseInt(t, 36);
  return { galaxy: n(parts[0]), sector: { sx: n(parts[1]), sy: n(parts[2]) }, system: n(parts[3]) };
}

/** The planet's own surface: the equirectangular map with a legend of its materials. */
function surfaceView(fb: IndexedBuffer, e: Explorer, sprites: SpriteSource): void {
  const s = e.surface;
  if (s === null) return;
  const a = s.address;
  const b = a.body;
  if (b === undefined || b.kind !== 'planet' || a.sector === undefined || a.system === undefined) return;
  const sys = e.world.system(a.sector.sx, a.sector.sy, a.system).system;
  const planet = sys.planets[b.index];
  const body = b.moon === undefined ? planet : planet.moons[b.moon];
  const name = b.moon === undefined ? (planet.properName ?? planet.name) : planet.moons[b.moon].name;
  // Dim the world behind with the glass table, thinned by the fade.
  const data = fb.data;
  for (let y = 0; y < SCREEN_H; y++) for (let x = 0; x < SCREEN_W; x++) if (keep(x, y, s.alpha)) data[y * SCREEN_W + x] = GLASS[data[y * SCREEN_W + x]];
  const size = stepSize(64, 512, 396);
  const map = sprites.get({ gen: 'surface', recipe: body.recipe, seed: body.look, size, frame: 0, light: -1 }, 2);
  const mx = (SCREEN_W - size) >> 1;
  const my = 30;
  if (map === undefined) {
    if (s.alpha >= 1) say(fb, 'genero la mappa...', mx + 4, my + 4, TEXT);
    return;
  }
  panel(fb, mx - 3, my - 3, map.buffer.w + 6, map.buffer.h + 6);
  blit(fb, map.buffer, mx, my, s.alpha);
  if (s.alpha < 1) return;
  say(fb, `${name} · mappa di superficie`, mx, my - 12, INK);
  const legend = (map.descriptor.legend as { material: string; ramp: string; share: number }[] | undefined) ?? [];
  let lx = mx;
  let ly = my + map.buffer.h + 7;
  for (const item of legend) {
    const label = `${MATERIAL_NAMES[item.material] ?? item.material} ${Math.round(item.share * 100)}%`;
    const w = textWidth(label, SMALL) + 12;
    if (lx + w > mx + size) {
      lx = mx;
      ly += 9;
    }
    const tones = palette.ramp(item.ramp).indices;
    rect(fb, lx, ly, 6, 6, tones[Math.min(tones.length - 1, 3)]);
    rect(fb, lx, ly + 3, 6, 3, tones[Math.min(tones.length - 1, 1)]);
    say(fb, label, lx + 9, ly, TEXT);
    lx += w + 4;
  }
}

function debugOverlay(fb: IndexedBuffer, e: Explorer, proj: Projection): void {
  const st = e.lastStats;
  const lines = [
    `fps ${e.fps.toFixed(0)}  frame ${e.frameMs} ms`,
    `z ${e.camera.z.toFixed(2)}  ${proj.s < 1000 ? proj.s.toFixed(1) : proj.s.toExponential(2)} px/settore`,
    `passaggio: ${e.world.transition === 'dither' ? 'dither' : 'secco'}  (t per cambiare)`,
  ];
  if (st !== null) {
    lines.push(`sprite ${st.sprites}  segnaposto ${st.placeholders}  punti ${st.dots}`);
    lines.push(st.maxStep === 0 ? 'gradini: nessuno sprite di corpi' : `gradini: ${st.minStep}-${st.maxStep} px (+20% l'uno)`);
    lines.push(`sistemi in dettaglio ${st.detailed}  campioni bagliore ${st.hazeSamples}`);
  }
  lines.push(...e.hostDebug);
  const w = Math.max(...lines.map((l) => textWidth(l, SMALL))) + 10;
  const h = lines.length * 7 + 8;
  panel(fb, 4, SCREEN_H - h - 12, w, h);
  lines.forEach((l, i) => drawText(fb, l, 9, SCREEN_H - h - 7 + i * 7, i === 0 ? INK : TEXT, SMALL));
}
