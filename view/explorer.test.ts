import { describe, expect, it } from 'vitest';
import { fingerprint } from '../core/fingerprint';
import { formatAddress, parseAddress } from '../universe/address';
import { buildBand } from './catalogue';
import { Explorer } from './explorer';
import { SPEEDS } from './clock';
import { dateOf, searchSystems } from './info';
import { SyncSprites } from './sprites';

const ADDRESS = '0.h.1p.0.p2';

function explorer(): Explorer {
  const e = new Explorer({ galaxy: 0, loadBand: buildBand });
  e.world.hazeBudget = Infinity;
  e.world.systemBudget = Infinity;
  e.help = false;
  return e;
}

describe('explorer', () => {
  it('renders the same bytes for the same view, and a golden of every level', async () => {
    const shots: Record<string, string> = {};
    // Sprites are shared: their determinism is pinned by the generators' goldens, this test
    // pins the composition (catalogue, glow, geometry, interface).
    const sprites = new SyncSprites();
    for (const level of ['region', 'system', 'body', 'surface'] as const) {
      const a = explorer();
      const b = explorer();
      for (const e of [a, b]) {
        e.goto(parseAddress(ADDRESS), level);
        e.selected = parseAddress(ADDRESS);
        e.tick = 500;
        e.render(sprites);
      }
      expect(fingerprint(b.fb)).toBe(fingerprint(a.fb));
      shots[level] = fingerprint(a.fb);
    }
    await expect(`${JSON.stringify(shots, null, 2)}\n`).toMatchFileSnapshot('../tests/golden/view.json');
  });

  it('runs the clock in whole ticks at each speed, and pauses', () => {
    const e = explorer();
    // Frames longer than 250 ms (a hidden tab) count as 250 ms.
    for (let i = 0; i < 4; i++) e.advance(250);
    expect(e.tick).toBe(SPEEDS[0]);
    e.handle({ type: 'key', key: '3', down: true });
    for (let i = 0; i < 60; i++) e.advance(16.7);
    // 60 frames of 17 ms at x100: about 100 ticks, never fractional.
    expect(Number.isInteger(e.tick)).toBe(true);
    expect(e.tick).toBeGreaterThan(95);
    e.handle({ type: 'key', key: ' ', down: true });
    const t = e.tick;
    e.advance(5000);
    expect(e.tick).toBe(t);
  });

  it('zooms with the wheel around the cursor and pans by dragging', () => {
    const e = explorer();
    const z = e.camera.z;
    e.handle({ type: 'wheel', x: 100, y: 100, dz: 1 });
    expect(e.camera.z).toBeCloseTo(z + 1, 9);
    const c = e.camera.center;
    e.handle({ type: 'down', x: 200, y: 100 });
    e.handle({ type: 'move', x: 230, y: 100 });
    e.handle({ type: 'up', x: 230, y: 100 });
    expect(e.camera.center.sx + e.camera.center.x).toBeLessThan(c.sx + c.x);
  });

  it('selects with a click, follows bodies, and deselects on empty space', () => {
    const e = explorer();
    e.goto(parseAddress(ADDRESS), 'body');
    e.render(new SyncSprites());
    e.handle({ type: 'down', x: 240, y: 135 });
    e.handle({ type: 'up', x: 240, y: 135 });
    expect(e.selected === null ? null : formatAddress(e.selected)).toBe(ADDRESS);
    expect(e.follow).not.toBeNull();
    // Time passes: the camera stays on the planet.
    e.tick += 200;
    e.advance(16);
    const [x, y] = e.screenOf(parseAddress(ADDRESS));
    expect(Math.abs(x - 240)).toBeLessThan(1);
    expect(Math.abs(y - 135)).toBeLessThan(1);
    e.handle({ type: 'down', x: 5, y: 260 });
    e.handle({ type: 'up', x: 5, y: 260 });
    expect(e.selected).toBeNull();
  });

  it('round-trips its state through the URL', () => {
    const e = explorer();
    e.goto(parseAddress(ADDRESS), 'body');
    e.selected = parseAddress(ADDRESS);
    e.tick = 777;
    const u = e.urlState();
    const f = explorer();
    expect(f.fromUrl(u.a, u.z, u.t)).toBe(true);
    expect(f.tick).toBe(777);
    expect(f.camera.z).toBeCloseTo(Number(u.z), 9);
    expect(formatAddress(f.selected!)).toBe(ADDRESS);
    expect(f.fromUrl('0.zzzz.0.0', null, null)).toBe(false);
  });

  it('searches by address at once and by name through the host', () => {
    const e = explorer();
    e.handle({ type: 'key', key: '/', down: true });
    for (const ch of '0.h.1p.0') e.handle({ type: 'key', key: ch, down: true });
    e.handle({ type: 'key', key: 'Enter', down: true });
    expect(e.search.open).toBe(false);
    expect(e.flight).not.toBeNull();
    e.handle({ type: 'key', key: '/', down: true });
    for (const ch of 'zhus') e.handle({ type: 'key', key: ch, down: true });
    e.handle({ type: 'key', key: 'Enter', down: true });
    const q = e.takeSearchRequest();
    expect(q).toBe('zhus');
    const results = searchSystems(e.galaxy, q as string, 17, 61, 5, 2000);
    expect(results.some((r) => r.address === '0.h.1p.0')).toBe(true);
    e.setSearchResults('zhus', results);
    expect(e.search.results.length).toBeGreaterThan(0);
  });

  it('shows the surface map past the body level', () => {
    const e = explorer();
    e.goto(parseAddress(ADDRESS), 'surface');
    e.render(new SyncSprites());
    expect(e.surface?.alpha).toBe(1);
    // Zooming further in is refused on the full map.
    const z = e.camera.z;
    e.handle({ type: 'wheel', x: 240, y: 135, dz: 1 });
    expect(e.camera.z).toBe(z);
  });

  it('writes simulated dates', () => {
    expect(dateOf(0)).toBe('anno 1, giorno 1, 00:00');
    expect(dateOf(8766 + 24 * 3 + 5)).toBe('anno 2, giorno 4, 05:00');
  });
});
