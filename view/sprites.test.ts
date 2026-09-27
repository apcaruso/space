import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../core/buffer';
import { canonicalJson, lightBin, lightVector, LIGHT_BINS, SpriteCache, spriteKey, SyncSprites, type SpriteRequest } from './sprites';

const req = (size: number, frame = 0, light = -1, seed = 1): SpriteRequest => ({ gen: 'planet', recipe: { archetype: 'ice', period: 24 }, seed, size, frame, light });
const sprite = (n: number) => ({ buffer: new IndexedBuffer(n, n), cx: n / 2, cy: n / 2, descriptor: {} });

describe('sprites', () => {
  it('quantise light into 32 directions that point where they should', () => {
    expect(lightBin(1, 0)).toBe(0);
    expect(lightBin(0, 1)).toBe(LIGHT_BINS / 4);
    expect(lightBin(-1, 0)).toBe(LIGHT_BINS / 2);
    expect(lightBin(0, 0)).toBe(-1);
    const v = lightVector(LIGHT_BINS / 4);
    expect(v?.y).toBeGreaterThan(0.9);
    expect(v?.z).toBeGreaterThan(0.3);
    expect(lightVector(-1)).toBeUndefined();
  });

  it('key recipes canonically and every field of the request', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    const a = spriteKey(req(24));
    expect(spriteKey({ ...req(24), recipe: { period: 24, archetype: 'ice' } })).toBe(a);
    expect(a).toContain('planet@2');
    for (const other of [req(29), req(24, 1), req(24, 0, 3), req(24, 0, -1, 2)]) expect(spriteKey(other)).not.toBe(a);
  });

  it('evict the least recently used beyond the memory limit, never what the frame uses', () => {
    const cache = new SpriteCache(3 * (100 + 64));
    cache.beginFrame();
    cache.set(req(10, 0), sprite(10));
    cache.set(req(10, 1), sprite(10));
    cache.beginFrame();
    cache.get(spriteKey(req(10, 0)));
    cache.set(req(10, 2), sprite(10));
    cache.set(req(10, 3), sprite(10));
    // Frame 1 was the oldest and not used this frame: gone. Frame 0 was used this frame: kept.
    expect(cache.has(spriteKey(req(10, 1)))).toBe(false);
    expect(cache.has(spriteKey(req(10, 0)))).toBe(true);
    expect(cache.stats().bytes).toBeLessThanOrEqual(3 * 164);
  });

  it('find the nearest ready size of the same object as a stand-in', () => {
    const cache = new SpriteCache();
    cache.set(req(12), sprite(12));
    cache.set(req(35), sprite(35));
    expect(cache.nearest(req(29))?.buffer.w).toBe(35);
    expect(cache.nearest(req(14))?.buffer.w).toBe(12);
    expect(cache.nearest(req(29, 0, -1, 9))).toBeUndefined();
  });

  it('generate synchronously in Node, once per key', () => {
    let clock = 0;
    const s = new SyncSprites(() => (clock += 5));
    const a = s.get(req(16));
    const b = s.get(req(16));
    expect(b).toBe(a);
    expect(s.stats.count.get('planet')).toBe(1);
    expect(a.buffer.w).toBeGreaterThanOrEqual(16);
  });
});
