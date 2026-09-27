import { expect, it } from 'vitest';
import { hashString } from '../core/hash';
import { formatAddress } from './address';
import { sampleSystems } from './census';
import { Galaxy } from './galaxy';
import { generateSystem, UNIVERSE_VERSION } from './system';

// Fixed outputs of the universe. A change means the same address now leads somewhere else: if
// it is intended, bump UNIVERSE_VERSION and regenerate with `npm test -- -u`.

function goldens(): Record<string, unknown> {
  const out: Record<string, unknown> = { version: UNIVERSE_VERSION };
  for (const seed of [0, 1]) {
    const g = new Galaxy(seed);
    const s = g.shape;
    out[`galaxy ${seed}`] = { radius: s.radius.toFixed(6), arms: s.arms, bar: s.bar.toFixed(6), pitch: s.pitch.toFixed(6) };
    out[`galaxy ${seed} sectors`] = [[0, 0], [-12, 40], [37, -5], [150, 150]].map(([x, y]) => {
      const info = g.sector(x, y);
      return `${x},${y}: sistemi ${info.count}, età ${info.age}, nebulosa ${info.nebula} ${info.nebulaRamp}, stile ${info.style}`;
    });
    out[`galaxy ${seed} systems`] = sampleSystems(g, 6, 0).map((r) => {
      const sys = generateSystem(g, r.sx, r.sy, r.index);
      const address = formatAddress({ galaxy: seed, sector: { sx: r.sx, sy: r.sy }, system: r.index });
      const planets = sys.planets.map((p) => `${p.archetype}${p.moons.length > 0 ? `+${p.moons.length}` : ''}`).join(' ');
      return `${address} ${sys.name} ${sys.code} ${sys.stars.map((st) => st.label).join('+')} [${planets}] ${hashString(JSON.stringify(sys)).toString(16).padStart(8, '0')}`;
    });
  }
  return out;
}

it('matches tests/golden/universe.json', async () => {
  const first = JSON.stringify(goldens(), null, 2);
  expect(JSON.stringify(goldens(), null, 2)).toBe(first);
  await expect(`${first}\n`).toMatchFileSnapshot('../tests/golden/universe.json');
});
