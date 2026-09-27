// The explorer's state and frame: camera, clock, catalogue, world, selection and interface.
// Pure: the app feeds it input events and elapsed milliseconds (as numbers) and presents its
// framebuffer; forge view drives it the same way in Node.

import { IndexedBuffer } from '../core/buffer';
import { LN2, log } from '../core/dmath';
import { formatAddress, parseAddress, resolve, AddressError, type Address } from '../universe/address';
import { delta } from '../universe/coords';
import { Galaxy } from '../universe/galaxy';
import { lookAt, pan, Projection, SCREEN_H, SCREEN_W, zoomAt, type Camera } from './camera';
import { Catalogue, type Band } from './catalogue';
import { SPEEDS } from './clock';
import { Flight } from './flight';
import type { SystemGeometry } from './geometry';
import { card, type Card, type SearchResult } from './info';
import { place, type Level, type Place } from './places';
import type { SpriteSource } from './sprites';
import { drawHud, hudHit, type HudHit } from './ui/hud';
import { World, type Target, type TransitionMode, type WorldStats } from './world';

export interface ExplorerOptions {
  readonly galaxy: number;
  /** Returns a catalogue band now (Node) or null and delivers it later with addBand (browser). */
  readonly loadBand: (galaxy: Galaxy, index: number) => Band | null;
  readonly transition?: TransitionMode;
}

/** Input in framebuffer pixels; `dz` in octaves of zoom (positive = closer). */
export type Input =
  | { readonly type: 'down'; readonly x: number; readonly y: number }
  | { readonly type: 'move'; readonly x: number; readonly y: number }
  | { readonly type: 'up'; readonly x: number; readonly y: number }
  | { readonly type: 'leave' }
  | { readonly type: 'wheel'; readonly x: number; readonly y: number; readonly dz: number }
  | { readonly type: 'dblclick'; readonly x: number; readonly y: number }
  | { readonly type: 'key'; readonly key: string; readonly down: boolean; readonly ctrl?: boolean };

export { SPEEDS };

export interface FrameStats extends WorldStats {
  readonly targets: number;
}

export interface SearchState {
  open: boolean;
  text: string;
  results: SearchResult[];
  index: number;
  busy: boolean;
  message: string;
}

const PAN_SPEED = 300; // pixels per second
const ZOOM_SPEED = 1.8; // octaves per second

export class Explorer {
  readonly galaxy: Galaxy;
  readonly catalogue: Catalogue;
  readonly world: World;
  readonly fb = new IndexedBuffer(SCREEN_W, SCREEN_H);
  camera: Camera;
  tick = 0;
  anim = 0;
  frameNo = 0;
  zoomDir = 0;
  speed = 0;
  paused = false;
  targets: Target[] = [];
  hover: Target | null = null;
  selected: Address | null = null;
  follow: Address | null = null;
  /** Where the followed body stays on screen, in pixels from the centre. */
  private followOffset: [number, number] = [0, 0];
  flight: Flight | null = null;
  debug = false;
  help = true;
  /** Extra debug lines from the host (worker timings, cache). */
  hostDebug: string[] = [];
  fps = 60;
  frameMs = 0;
  lastStats: FrameStats | null = null;
  readonly search: SearchState = { open: false, text: '', results: [], index: 0, busy: false, message: '' };
  /** A name search the host should run (worker); taken with takeSearchRequest. */
  private searchRequest: string | null = null;
  /** Surface view: the body shown and how far the fade has gone (0..1). */
  surface: { address: Address; alpha: number } | null = null;
  message = '';
  private messageMs = 0;
  private tickAcc = 0;
  private animMs = 0;
  private zoomIdleMs = 0;
  private flightTarget: Address | null = null;
  private readonly keys = new Set<string>();
  private pointer = { x: SCREEN_W / 2, y: SCREEN_H / 2, down: false, sx: 0, sy: 0, moved: 0, inside: false };
  private hud: HudHit[] = [];
  private cardCache: { key: string; card: Card } | null = null;

  constructor(o: ExplorerOptions) {
    this.galaxy = new Galaxy(o.galaxy);
    this.catalogue = new Catalogue(this.galaxy, (i) => o.loadBand(this.galaxy, i));
    this.world = new World(this.galaxy, this.catalogue);
    if (o.transition !== undefined) this.world.transition = o.transition;
    this.camera = lookAt({ sx: 0, sy: 0, x: 0, y: 0 }, this.place({ galaxy: this.galaxy.seed }).zoom.galaxy);
  }

  addBand(band: Band): void {
    this.catalogue.add(band);
  }

  geometry = (sx: number, sy: number, i: number): SystemGeometry => this.world.system(sx, sy, i).geometry;

  place(address: Address, tick = this.tick): Place {
    return place(this.galaxy, address, tick, this.geometry);
  }

  /** Centres the camera on an address at a level (or a zoom value), at once. */
  goto(address: Address, level: Level | number): void {
    const p = this.place(address);
    this.camera = lookAt(p.point, typeof level === 'number' ? level : p.zoom[level]);
    this.flight = null;
  }

  /** Flies the camera to an address at a level; bodies are followed on arrival. */
  flyTo(address: Address, level: Level | number): void {
    const p = this.place(address);
    const to = lookAt(p.point, typeof level === 'number' ? level : p.zoom[level]);
    this.flight = new Flight(this.camera, to);
    this.flightTarget = address.body !== undefined ? address : null;
    this.follow = null;
  }

  /** Natural level to look at an address. */
  levelOf(address: Address): Level {
    if (address.body !== undefined) return address.body.kind === 'belt' || address.body.kind === 'comet' ? 'system' : 'body';
    if (address.system !== undefined) return 'system';
    if (address.sector !== undefined) return 'region';
    return 'galaxy';
  }

  // --- time -------------------------------------------------------------------------------

  /** Real time elapsed since the last frame, in whole milliseconds. */
  advance(ms: number): void {
    const dt = Math.max(0, Math.min(250, Math.round(ms)));
    if (dt > 0) {
      this.frameMs = dt;
      this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;
    }
    if (!this.paused) {
      this.tickAcc += dt * SPEEDS[this.speed];
      const ticks = Math.floor(this.tickAcc / 1000);
      this.tick += ticks;
      this.tickAcc -= ticks * 1000;
    }
    this.animMs += dt;
    this.anim = Math.floor((this.animMs * 12) / 1000);
    if (this.messageMs > 0) this.messageMs = Math.max(0, this.messageMs - dt);

    // Held keys: pan and zoom.
    const k = (a: string, b: string) => (this.keys.has(a) || this.keys.has(b) ? 1 : 0);
    const dx = k('ArrowRight', 'd') - k('ArrowLeft', 'a');
    const dy = k('ArrowDown', 's') - k('ArrowUp', 'w');
    if (dx !== 0 || dy !== 0) {
      this.camera = pan(this.camera, (-dx * PAN_SPEED * dt) / 1000, (-dy * PAN_SPEED * dt) / 1000);
      this.follow = null;
      this.flight = null;
    }
    const dz = k('+', 'e') + k('=', 'E') - k('-', 'q') - k('_', 'Q');
    if (dz !== 0) this.zoomBy(SCREEN_W / 2, SCREEN_H / 2, (Math.sign(dz) * ZOOM_SPEED * dt) / 1000);

    if (this.flight !== null) {
      this.camera = this.flight.advance(dt);
      this.zoomDir = 0;
      if (this.flight.done) {
        this.flight = null;
        this.startFollow(this.flightTarget);
      }
    } else if (this.follow !== null) {
      const p = this.place(this.follow);
      const s = new Projection(this.camera).s;
      const [ox, oy] = this.followOffset;
      this.camera = lookAt(p.point, this.camera.z, -ox / s, -oy / s);
    }
    this.zoomIdleMs += dt;
    if (this.zoomIdleMs > 300) this.zoomDir = 0;
  }

  private zoomBy(x: number, y: number, dz: number): void {
    if (this.surface !== null && this.surface.alpha >= 1 && dz > 0) return;
    this.flight = null;
    if (this.follow !== null) {
      // Zoom around the followed body, which stays where it is on screen.
      const [ox, oy] = this.followOffset;
      this.camera = zoomAt(this.camera, SCREEN_W / 2 + ox, SCREEN_H / 2 + oy, dz);
    } else {
      this.camera = zoomAt(this.camera, x, y, dz);
    }
    this.zoomDir = Math.sign(dz);
    this.zoomIdleMs = 0;
  }

  // --- input ------------------------------------------------------------------------------

  handle(e: Input): void {
    switch (e.type) {
      case 'down': {
        this.pointer = { ...this.pointer, x: e.x, y: e.y, down: true, sx: e.x, sy: e.y, moved: 0, inside: true };
        return;
      }
      case 'move': {
        const p = this.pointer;
        if (p.down) {
          const ddx = e.x - p.x;
          const ddy = e.y - p.y;
          p.moved += Math.abs(ddx) + Math.abs(ddy);
          if (p.moved > 3) {
            this.camera = pan(this.camera, ddx, ddy);
            this.follow = null;
            this.flight = null;
          }
        }
        p.x = e.x;
        p.y = e.y;
        p.inside = true;
        this.hover = this.pick(e.x, e.y);
        return;
      }
      case 'up': {
        const p = this.pointer;
        const click = p.down && p.moved <= 3;
        p.down = false;
        if (click) this.click(e.x, e.y);
        return;
      }
      case 'leave':
        this.pointer.inside = false;
        this.pointer.down = false;
        this.hover = null;
        return;
      case 'wheel':
        this.zoomBy(e.x, e.y, e.dz);
        return;
      case 'dblclick': {
        const t = this.pick(e.x, e.y);
        if (t !== null) {
          this.selected = t.address;
          this.flyTo(t.address, this.levelOf(t.address));
        }
        return;
      }
      case 'key':
        if (e.down) this.keyDown(e.key, e.ctrl === true);
        else this.keys.delete(e.key);
        return;
    }
  }

  private click(x: number, y: number): void {
    const hit = hudHit(this.hud, x, y);
    if (hit !== null) {
      this.hudAction(hit);
      return;
    }
    if (this.search.open) {
      this.search.open = false;
      return;
    }
    const t = this.pick(x, y);
    if (t === null) {
      this.selected = null;
      this.follow = null;
      return;
    }
    this.selected = t.address;
    this.startFollow(t.address.body !== undefined && t.address.body.kind !== 'belt' ? t.address : null);
  }

  /** Follows a body from where it is on screen now (null stops following). */
  startFollow(address: Address | null): void {
    this.follow = address;
    if (address === null) return;
    const [x, y] = this.screenOf(address);
    this.followOffset = [x - SCREEN_W / 2, y - SCREEN_H / 2];
  }

  private hudAction(hit: HudHit): void {
    switch (hit.action) {
      case 'crumb':
        if (hit.address !== undefined) {
          this.selected = hit.address.sector === undefined ? null : hit.address;
          this.flyTo(hit.address, this.levelOf(hit.address));
        }
        return;
      case 'pause':
        this.paused = !this.paused;
        return;
      case 'faster':
        this.speed = (this.speed + 1) % SPEEDS.length;
        return;
      case 'close':
        this.selected = null;
        this.follow = null;
        return;
      case 'goto':
        if (hit.address !== undefined) {
          this.selected = hit.address;
          this.flyTo(hit.address, this.levelOf(hit.address));
        }
        return;
      case 'result':
        if (hit.address !== undefined) {
          this.search.open = false;
          this.selected = hit.address;
          this.flyTo(hit.address, 'system');
        }
        return;
    }
  }

  private keyDown(key: string, ctrl: boolean): void {
    if (this.search.open) {
      this.searchKey(key);
      return;
    }
    switch (key) {
      case ' ':
        this.paused = !this.paused;
        return;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        this.speed = Number(key) - 1;
        this.paused = false;
        return;
      case ',':
        this.speed = Math.max(0, this.speed - 1);
        return;
      case '.':
        this.speed = Math.min(SPEEDS.length - 1, this.speed + 1);
        return;
      case '/':
        this.openSearch();
        return;
      case 'k':
        if (ctrl) this.openSearch();
        return;
      case 'F3':
        this.debug = !this.debug;
        return;
      case 'h':
      case '?':
        this.help = !this.help;
        return;
      case 't':
        this.world.transition = this.world.transition === 'dither' ? 'cut' : 'dither';
        this.say(`passaggio tra gradini: ${this.world.transition === 'dither' ? 'dissolvenza a dither' : 'cambio secco'}`);
        return;
      case 'f':
        if (this.selected !== null && this.selected.body !== undefined) this.startFollow(this.follow === null ? this.selected : null);
        return;
      case 'z':
      case 'Enter':
        if (this.selected !== null) this.flyTo(this.selected, this.levelOf(this.selected));
        return;
      case 'g':
      case 'Home':
        this.selected = null;
        this.flyTo({ galaxy: this.galaxy.seed }, 'galaxy');
        return;
      case 'Escape':
        if (this.selected !== null) {
          this.selected = null;
          this.follow = null;
        } else {
          this.zoomOut();
        }
        return;
      default:
        this.keys.add(key);
    }
  }

  /** Up one level: from a body to its system, from a system to its region... */
  private zoomOut(): void {
    const c = this.context();
    if (c.body !== undefined) this.flyTo({ ...c, body: undefined }, 'system');
    else if (c.system !== undefined) this.flyTo({ ...c, system: undefined, body: undefined }, 'region');
    else this.flyTo({ galaxy: this.galaxy.seed }, 'galaxy');
  }

  private openSearch(): void {
    this.search.open = true;
    this.search.text = '';
    this.search.results = [];
    this.search.index = 0;
    this.search.message = 'nome, sigla (KX-4471) o indirizzo';
  }

  private searchKey(key: string): void {
    const s = this.search;
    if (key === 'Escape') {
      s.open = false;
    } else if (key === 'Backspace') {
      s.text = s.text.slice(0, -1);
    } else if (key === 'ArrowDown') {
      s.index = Math.min(s.results.length - 1, s.index + 1);
    } else if (key === 'ArrowUp') {
      s.index = Math.max(0, s.index - 1);
    } else if (key === 'Enter') {
      if (s.results.length > 0 && s.index < s.results.length) {
        const a = parseAddress(s.results[s.index].address);
        s.open = false;
        this.selected = a;
        this.flyTo(a, 'system');
        return;
      }
      const text = s.text.trim();
      try {
        const a = parseAddress(text);
        resolve(a, this.galaxy);
        s.open = false;
        this.selected = a.sector === undefined ? null : a;
        this.flyTo(a, this.levelOf(a));
      } catch (e) {
        if (!(e instanceof AddressError)) throw e;
        if (text.length < 2) {
          s.message = 'scrivi almeno due lettere';
          return;
        }
        s.busy = true;
        s.message = 'cerco...';
        this.searchRequest = text;
      }
    } else if (key.length === 1 && s.text.length < 40) {
      s.text += key;
    }
  }

  /** The name search the host should run now, if any. */
  takeSearchRequest(): string | null {
    const r = this.searchRequest;
    this.searchRequest = null;
    return r;
  }

  setSearchResults(query: string, results: SearchResult[]): void {
    const s = this.search;
    if (s.text.trim() !== query) return;
    s.busy = false;
    s.results = results;
    s.index = 0;
    s.message = results.length === 0 ? `nessun sistema con "${query}"` : `${results.length} risultati: invio per andare`;
  }

  say(text: string): void {
    this.message = text;
    this.messageMs = 2500;
  }

  get messageVisible(): boolean {
    return this.messageMs > 0;
  }

  /** Nearest hit target under a point: small things win over big ones they sit on. */
  pick(x: number, y: number): Target | null {
    let best: Target | null = null;
    let bestScore = Infinity;
    for (const t of this.targets) {
      const d = Math.sqrt((t.x - x) * (t.x - x) + (t.y - y) * (t.y - y));
      if (d > t.r + 3) continue;
      const score = d / Math.max(3, t.r) + t.r * 0.001;
      if (score <= bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }

  // --- where we are -------------------------------------------------------------------------

  /** Address of what the camera looks at: galaxy, sector, system, body. */
  context(): Address {
    const g = this.galaxy.seed;
    const proj = new Projection(this.camera);
    const c = this.camera.center;
    if (proj.s < 3) return { galaxy: g };
    const sector = { sx: c.sx, sy: c.sy };
    let best: Target | null = null;
    let bestD = Infinity;
    for (const t of this.targets) {
      if (t.kind !== 'system' || proj.s < 400) continue;
      const d = Math.abs(t.x - SCREEN_W / 2) + Math.abs(t.y - SCREEN_H / 2);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best === null) return { galaxy: g, sector };
    const sys = best.address;
    const extent = this.geometry(sys.sector!.sx, sys.sector!.sy, sys.system!).extent * proj.s;
    if (bestD > extent * 1.4) return { galaxy: g, sector };
    let body: Target | null = null;
    for (const t of this.targets) {
      if ((t.kind !== 'planet' && t.kind !== 'moon') || t.r < 12) continue;
      if (formatAddress(t.address).indexOf(formatAddress(sys)) !== 0) continue;
      const d = Math.sqrt((t.x - SCREEN_W / 2) * (t.x - SCREEN_W / 2) + (t.y - SCREEN_H / 2) * (t.y - SCREEN_H / 2));
      if (d <= t.r * 1.2 && (body === null || t.r < body.r)) body = t;
    }
    return body !== null ? body.address : sys;
  }

  /** Card of the selected object. */
  selectedCard(): Card | null {
    if (this.selected === null || this.selected.system === undefined) return null;
    const key = formatAddress(this.selected);
    if (this.cardCache?.key === key) return this.cardCache.card;
    const a = this.selected;
    const sys = this.world.system(a.sector!.sx, a.sector!.sy, a.system!).system;
    const c = card(sys, a);
    this.cardCache = { key, card: c };
    return c;
  }

  /** State for the URL: address of the selection (or of the view), zoom, tick. */
  urlState(): { a: string; z: string; t: string } {
    return { a: formatAddress(this.selected ?? this.context()), z: this.camera.z.toFixed(2), t: String(this.tick) };
  }

  /** Restores a view from URL parameters; returns false if the address is not valid. */
  fromUrl(a: string | null, z: string | null, t: string | null): boolean {
    if (t !== null && /^\d+$/.test(t)) this.tick = Number(t);
    if (a === null) return true;
    try {
      const address = parseAddress(a);
      if (address.galaxy !== this.galaxy.seed) return false;
      resolve(address, this.galaxy);
      const zoom = z !== null && Number.isFinite(Number(z)) ? Number(z) : this.levelOf(address);
      this.goto(address, zoom);
      if (address.sector !== undefined) this.selected = address;
      if (address.body !== undefined && address.body.kind !== 'belt') this.startFollow(address);
      return true;
    } catch (e) {
      if (e instanceof AddressError) return false;
      throw e;
    }
  }

  // --- frame --------------------------------------------------------------------------------

  /** Draws world and interface into the framebuffer. */
  render(sprites: SpriteSource): FrameStats {
    sprites.beginFrame();
    const proj = new Projection(this.camera);
    const selected = this.selected === null ? undefined : formatAddress(this.selected);
    const r = this.world.render(this.fb, { proj, tick: this.tick, anim: this.anim, frameNo: this.frameNo, zoomDir: this.zoomDir, selected }, sprites);
    this.targets = r.targets;
    if (this.pointer.inside && !this.pointer.down) this.hover = this.pick(this.pointer.x, this.pointer.y);
    this.updateSurface(proj);
    this.hud = drawHud(this.fb, this, proj, sprites);
    sprites.endFrame();
    this.frameNo++;
    this.lastStats = { ...r.stats, targets: r.targets.length };
    return this.lastStats;
  }

  /** The surface view fades in when a planet or moon under the centre is larger than the screen. */
  private updateSurface(proj: Projection): void {
    const c = this.context();
    const body = c.body;
    if (body === undefined || body.kind !== 'planet') {
      this.surface = null;
      return;
    }
    const g = this.geometry(c.sector!.sx, c.sector!.sy, c.system!);
    const r = body.moon === undefined ? g.planetRadius[body.index] : g.moonRadius[body.index][body.moon];
    const d = 2 * r * proj.s;
    const alpha = Math.min(1, Math.max(0, (d - 280) / 80));
    this.surface = alpha > 0 ? { address: c, alpha } : null;
    // Past the full surface view there is nothing closer to see.
    if (d > 420) this.camera = { center: this.camera.center, z: this.camera.z - log(d / 420) / LN2 };
  }

  /** Distance in pixels between the camera and a point, for tests and tools. */
  screenOf(address: Address): [number, number] {
    const p = this.place(address).point;
    const [dx, dy] = delta(this.camera.center, p);
    const s = new Projection(this.camera).s;
    return [SCREEN_W / 2 + dx * s, SCREEN_H / 2 + dy * s];
  }
}
