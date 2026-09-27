import { describe, expect, it } from 'vitest';
import { derive } from '../core/hash';
import { catalogCode, catalogNumbers, foldName, isOffensive, isRealName, planetLetter, properName, roman, sectorLetters, starLetter } from './names';

describe('names', () => {
  it('are deterministic and differ by style', () => {
    expect(properName(0, 12345)).toBe(properName(0, 12345));
    const styles = [0, 1, 2, 3, 4].map((s) => Array.from({ length: 40 }, (_, i) => properName(s, derive(9, i))));
    for (const names of styles) expect(new Set(names).size).toBeGreaterThan(35);
    // Each language has its own look: apostrophes in the harsh one, hyphens in the compound one.
    expect(styles[4].some((n) => n.includes('-'))).toBe(true);
    expect(styles[1].some((n) => n.includes("'"))).toBe(true);
    expect(styles[2].every((n) => !n.includes('-') && !n.includes("'"))).toBe(true);
  });

  it('filter real and offensive names', () => {
    expect(isRealName('Vega')).toBe(true);
    expect(isRealName('vEGA')).toBe(true);
    expect(isRealName('Vegara')).toBe(false);
    expect(isOffensive('Kazzo')).toBe(false);
    expect(isOffensive('Cazzola')).toBe(true);
    expect(isOffensive("Sh'it")).toBe(true);
    expect(isOffensive('Mèrda')).toBe(true);
    expect(foldName("Ké'la-Na")).toBe('kelana');
  });

  it('never produce a filtered, empty or overlong name', () => {
    for (let style = 0; style < 5; style++) {
      for (let i = 0; i < 4000; i++) {
        const n = properName(style, derive(style, 'test', i));
        expect(isRealName(n) || isOffensive(n)).toBe(false);
        expect(foldName(n).length).toBeGreaterThanOrEqual(3);
        expect(foldName(n).length).toBeLessThanOrEqual(10);
        expect(n[0]).toBe(n[0].toUpperCase());
      }
    }
  });

  it('avoid names already taken', () => {
    const first = properName(2, 77);
    expect(properName(2, 77, new Set([first]))).not.toBe(first);
  });

  it('write catalogue codes, letters and numerals', () => {
    const letters = sectorLetters(derive(5, 'sector', 1, 2));
    expect(letters).toMatch(/^[A-HJ-NP-Z]{2}$/);
    const numbers = catalogNumbers(99, 16);
    expect(new Set(numbers).size).toBe(16);
    expect(catalogCode('KX', 4471)).toBe('KX-4471');
    expect([0, 1, 2, 24, 25].map(planetLetter)).toEqual(['b', 'c', 'd', 'z', 'bb']);
    expect([0, 1, 2].map(starLetter)).toEqual(['A', 'B', 'C']);
    expect([1, 2, 4, 9, 14, 40, 1999].map(roman)).toEqual(['I', 'II', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIX']);
  });
});
