import { describe, expect, it } from 'vitest';
import { censusOf, EXPECTED } from './census';
import { Galaxy } from './galaxy';

describe('census of 10,000 systems', () => {
  it('matches the expected distributions of stars, planets and moons', () => {
    // The printed version of this census is `npm run forge -- census` (see forge/cli.test.ts).
    const c = censusOf(new Galaxy(0), 10_000);
    for (const e of EXPECTED) {
      const v = e.value(c);
      expect(v, e.label).toBeGreaterThanOrEqual(e.min);
      expect(v, e.label).toBeLessThanOrEqual(e.max);
    }
    // Every archetype and every class shows up.
    for (const share of Object.values(c.archetypes)) expect(share).toBeGreaterThan(0);
    for (const share of Object.values(c.classes)) expect(share).toBeGreaterThan(0);
  });
});
