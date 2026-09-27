// Sprites generated in a pool of Web Workers. The page never generates: missing sprites are
// queued each frame by priority, sent to the worker that owns the object (so its caches help),
// and drawn from the cache when they come back. Stale requests are dropped before they start.

import { hashString } from '../core/hash';
import type { Band } from '../view/catalogue';
import type { SearchResult } from '../view/info';
import { emptyStats, fromMessage, objectKey, recordGeneration, SpriteCache, spriteKey, type Sprite, type SpriteMessage, type SpriteRequest, type SpriteSource } from '../view/sprites';
import type { WorkerRequest } from './worker';

type WorkerReply =
  | { type: 'sprite'; key: string; sprite: SpriteMessage; ms: number }
  | { type: 'error'; key: string; message: string }
  | { type: 'band'; band: Band; ms: number }
  | { type: 'search'; query: string; results: SearchResult[]; ms: number };

/** Jobs in flight per worker: enough to keep it busy, few enough to stay responsive. */
const IN_FLIGHT = 3;

export class WorkerPool implements SpriteSource {
  readonly cache = new SpriteCache(48 * 1024 * 1024);
  readonly stats = emptyStats();
  private readonly workers: Worker[] = [];
  private readonly busy: number[] = [];
  private readonly flying = new Map<string, number>();
  private readonly failed = new Set<string>();
  private wanted = new Map<string, { req: SpriteRequest; priority: number }>();
  private readonly bandQueue: { galaxy: number; index: number }[] = [];
  onBand: (band: Band) => void = () => {};
  onSearch: (query: string, results: SearchResult[]) => void = () => {};
  bandMs = 0;

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerReply>) => this.reply(i, e.data);
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  get size(): number {
    return this.workers.length;
  }

  get pending(): number {
    return this.flying.size + this.wanted.size;
  }

  private reply(worker: number, m: WorkerReply): void {
    this.busy[worker]--;
    switch (m.type) {
      case 'sprite': {
        const job = this.flying.get(m.key);
        this.flying.delete(m.key);
        if (job === undefined) return;
        const req = this.requests.get(m.key);
        this.requests.delete(m.key);
        if (req !== undefined) {
          this.cache.set(req, fromMessage(m.sprite));
          recordGeneration(this.stats, req.gen, m.ms);
        }
        break;
      }
      case 'error':
        this.flying.delete(m.key);
        this.requests.delete(m.key);
        this.failed.add(m.key);
        console.warn('generazione fallita', m.key, m.message);
        break;
      case 'band':
        this.bandMs += m.ms;
        this.onBand(m.band);
        break;
      case 'search':
        this.onSearch(m.query, m.results);
        break;
    }
    this.pump();
  }

  private readonly requests = new Map<string, SpriteRequest>();

  get(req: SpriteRequest, priority = 1): Sprite | undefined {
    const key = spriteKey(req);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (!this.failed.has(key)) {
      const prev = this.wanted.get(key);
      if (prev === undefined || prev.priority < priority) this.wanted.set(key, { req, priority });
    }
    return undefined;
  }

  nearest(req: SpriteRequest): Sprite | undefined {
    return this.cache.nearest(req);
  }

  prefetch(req: SpriteRequest): void {
    const key = spriteKey(req);
    if (this.cache.has(key) || this.wanted.has(key)) return;
    this.wanted.set(key, { req, priority: 0 });
  }

  beginFrame(): void {
    this.cache.beginFrame();
    this.wanted = new Map();
  }

  endFrame(): void {
    this.pump();
  }

  /** Catalogue bands, nearest to `band` first; bands go before sprites. */
  loadBands(galaxy: number, count: number, near: number): void {
    const order = Array.from({ length: count }, (_, i) => i).sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
    for (const index of order) this.bandQueue.push({ galaxy, index });
    this.pump();
  }

  search(galaxy: number, query: string, cx: number, cy: number): void {
    // The least busy worker; searches are rare.
    let w = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.busy[i] < this.busy[w]) w = i;
    this.post(w, { type: 'search', galaxy, query, cx, cy });
  }

  private post(worker: number, m: WorkerRequest): void {
    this.busy[worker]++;
    this.workers[worker].postMessage(m);
  }

  /** Sends queued work to idle workers: bands first, then sprites by priority. */
  private pump(): void {
    for (let w = 0; w < this.workers.length && this.bandQueue.length > 0; w++) {
      while (this.busy[w] < IN_FLIGHT && this.bandQueue.length > 0) {
        const b = this.bandQueue.shift() as { galaxy: number; index: number };
        this.post(w, { type: 'band', galaxy: b.galaxy, index: b.index });
      }
    }
    if (this.wanted.size === 0) return;
    const jobs = [...this.wanted.entries()].filter(([key]) => !this.flying.has(key)).sort((a, b) => b[1].priority - a[1].priority);
    for (const [key, { req, priority }] of jobs) {
      // Objects stay on one worker, so its map caches serve every size and frame.
      const w = hashString(objectKey(req)) % this.workers.length;
      if (this.busy[w] >= IN_FLIGHT) continue;
      this.flying.set(key, priority);
      this.requests.set(key, req);
      this.wanted.delete(key);
      this.post(w, { type: 'sprite', key, req });
    }
  }

  /** Average generation time per generator, for the debug overlay. */
  timings(): string[] {
    const out: string[] = [];
    for (const gen of [...this.stats.count.keys()].sort()) {
      const n = this.stats.count.get(gen) as number;
      out.push(`${gen} ${((this.stats.ms.get(gen) as number) / n).toFixed(1)} ms × ${n}`);
    }
    return out;
  }
}
