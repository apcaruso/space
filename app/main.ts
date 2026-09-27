// The explorer in the browser: canvas presentation, input, clock and URL around the pure
// Explorer of view/, with sprites, catalogue and searches generated in Web Workers.

import { masterPalette } from '../toolkit/palette';
import { parseAddress } from '../universe/address';
import { SCREEN_H, SCREEN_W } from '../view/camera';
import { BAND_ROWS, catalogueExtent } from '../view/catalogue';
import { Explorer, type Input } from '../view/explorer';
import { paletteWords, present } from '../view/present';
import { WorkerPool } from './sprites';

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (canvas === null) throw new Error('missing #screen canvas');
canvas.width = SCREEN_W;
canvas.height = SCREEN_H;
const ctx = canvas.getContext('2d', { alpha: false });
if (ctx === null) throw new Error('2d context not available');

// Integer scale in device pixels, so one game pixel is always an exact block of screen pixels.
function fit(): void {
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.max(1, Math.floor(Math.min((window.innerWidth * dpr) / SCREEN_W, (window.innerHeight * dpr) / SCREEN_H)));
  canvas!.style.width = `${(SCREEN_W * scale) / dpr}px`;
  canvas!.style.height = `${(SCREEN_H * scale) / dpr}px`;
}
fit();
window.addEventListener('resize', fit);

// --- explorer and workers -------------------------------------------------------------------

const params = new URLSearchParams(location.search);
let galaxySeed = 0;
const a = params.get('a');
if (a !== null) {
  try {
    galaxySeed = parseAddress(a).galaxy;
  } catch {
    galaxySeed = 0;
  }
}

const pool = new WorkerPool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
const explorer = new Explorer({ galaxy: galaxySeed, loadBand: () => null });
pool.onBand = (band) => explorer.addBand(band);
pool.onSearch = (query, results) => explorer.setSearchResults(query, results);
if (!explorer.fromUrl(a, params.get('z'), params.get('t'))) explorer.say('indirizzo non valido nel link');
if (params.get('debug') !== null) explorer.debug = true;
const bandOf = explorer.camera.center.sy + catalogueExtent(explorer.galaxy);
pool.loadBands(galaxySeed, explorer.catalogue.bands.length, Math.floor(bandOf / BAND_ROWS));

// --- presentation -----------------------------------------------------------------------------

const palette = masterPalette();
const image = ctx.createImageData(SCREEN_W, SCREEN_H);
const pixels = new Uint32Array(image.data.buffer);
// Star twinkle as palette cycling on the presentation table: free, whatever is on screen.
const TWINKLE_PERIOD = 6;
let wordsFrame = -1;
let words = paletteWords(palette);

function presentFrame(): void {
  const step = Math.floor(explorer.anim / 2);
  if (step !== wordsFrame) {
    wordsFrame = step;
    words = paletteWords(palette, palette.cycleTable('metal-light', step, { from: 0, to: 2, period: TWINKLE_PERIOD / 2 }));
  }
  present(explorer.fb, words, pixels);
  ctx!.putImageData(image, 0, 0);
}

// --- input ------------------------------------------------------------------------------------

function toFb(e: { clientX: number; clientY: number }): [number, number] {
  const r = canvas!.getBoundingClientRect();
  return [((e.clientX - r.left) * SCREEN_W) / r.width, ((e.clientY - r.top) * SCREEN_H) / r.height];
}

const send = (i: Input) => explorer.handle(i);
const touches = new Map<number, [number, number]>();
let pinch: { d: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas!.setPointerCapture(e.pointerId);
  const [x, y] = toFb(e);
  touches.set(e.pointerId, [x, y]);
  if (touches.size === 2) {
    const [p, q] = [...touches.values()];
    pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
    send({ type: 'up', x: -1, y: -1 });
    return;
  }
  send({ type: 'down', x, y });
});
canvas.addEventListener('pointermove', (e) => {
  const [x, y] = toFb(e);
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [x, y]);
  if (pinch !== null && touches.size === 2) {
    const [p, q] = [...touches.values()];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > 0 && pinch.d > 0) send({ type: 'wheel', x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, dz: Math.log2(d / pinch.d) });
    pinch.d = d;
    return;
  }
  send({ type: 'move', x, y });
});
const release = (e: PointerEvent) => {
  const [x, y] = toFb(e);
  touches.delete(e.pointerId);
  if (pinch !== null) {
    if (touches.size < 2) pinch = null;
    return;
  }
  send({ type: 'up', x, y });
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => send({ type: 'leave' }));
canvas.addEventListener('dblclick', (e) => {
  const [x, y] = toFb(e);
  send({ type: 'dblclick', x, y });
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const [x, y] = toFb(e);
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    send({ type: 'wheel', x, y, dz: (-e.deltaY * unit) / 400 });
  },
  { passive: false },
);
const CAPTURED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', '/', 'F3', 'Home', 'Escape', 'Enter', 'Backspace']);
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.altKey) return;
  if (CAPTURED.has(e.key) || (e.ctrlKey && e.key === 'k')) e.preventDefault();
  send({ type: 'key', key: e.key, down: true, ctrl: e.ctrlKey });
});
window.addEventListener('keyup', (e) => send({ type: 'key', key: e.key, down: false }));
window.addEventListener('blur', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'q', 'e', '+', '-', '=', '_']) send({ type: 'key', key, down: false });
});

// --- loop -------------------------------------------------------------------------------------

let last = performance.now();
let lastUrl = '';
let urlMs = 0;
let renderMs = 0;

function frame(now: number): void {
  const ms = now - last;
  last = now;
  explorer.advance(ms);
  const query = explorer.takeSearchRequest();
  if (query !== null) pool.search(explorer.galaxy.seed, query, explorer.camera.center.sx, explorer.camera.center.sy);
  const t0 = performance.now();
  explorer.render(pool);
  presentFrame();
  renderMs = renderMs * 0.9 + (performance.now() - t0) * 0.1;
  const c = pool.cache.stats();
  explorer.hostDebug = [
    `render ${renderMs.toFixed(1)} ms  worker ${pool.size}  in coda ${pool.pending}`,
    `cache ${c.entries} sprite, ${(c.bytes / 1048576).toFixed(1)} MB`,
    ...pool.timings(),
  ];
  urlMs += ms;
  if (urlMs > 250) {
    urlMs = 0;
    const u = explorer.urlState();
    const search = `?a=${u.a}&z=${u.z}&t=${u.t}`;
    if (search !== lastUrl) {
      lastUrl = search;
      history.replaceState(null, '', search);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For automated checks: the explorer and the pool from the console.
(window as unknown as { explorer: Explorer; pool: WorkerPool }).explorer = explorer;
(window as unknown as { explorer: Explorer; pool: WorkerPool }).pool = pool;
