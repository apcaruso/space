// Generation worker: sprites, catalogue bands and name searches, off the main thread.

import { Galaxy } from '../universe/galaxy';
import { bandBuffers, buildBand } from '../view/catalogue';
import { searchSystems } from '../view/info';
import { generateSprite, toMessage, type SpriteRequest } from '../view/sprites';

export type WorkerRequest =
  | { readonly type: 'sprite'; readonly key: string; readonly req: SpriteRequest }
  | { readonly type: 'band'; readonly galaxy: number; readonly index: number }
  | { readonly type: 'search'; readonly galaxy: number; readonly query: string; readonly cx: number; readonly cy: number };

const galaxies = new Map<number, Galaxy>();
function galaxy(seed: number): Galaxy {
  let g = galaxies.get(seed);
  if (g === undefined) {
    g = new Galaxy(seed);
    galaxies.set(seed, g);
  }
  return g;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const m = event.data;
  const t0 = performance.now();
  if (m.type === 'sprite') {
    try {
      const sprite = toMessage(generateSprite(m.req));
      (self as unknown as Worker).postMessage({ type: 'sprite', key: m.key, sprite, ms: performance.now() - t0 }, [sprite.data.buffer]);
    } catch (e) {
      (self as unknown as Worker).postMessage({ type: 'error', key: m.key, message: (e as Error).message });
    }
  } else if (m.type === 'band') {
    const band = buildBand(galaxy(m.galaxy), m.index);
    (self as unknown as Worker).postMessage({ type: 'band', band, ms: performance.now() - t0 }, bandBuffers(band));
  } else {
    const results = searchSystems(galaxy(m.galaxy), m.query, m.cx, m.cy, 10);
    (self as unknown as Worker).postMessage({ type: 'search', query: m.query, results, ms: performance.now() - t0 });
  }
};
