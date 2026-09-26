import { describe, expect, it } from 'vitest';
import { grid, rows } from './grid';
import { outline } from './outline';
import { Palette } from './palette';

// Ramps a = [1, 2, 3] (reds), b = [4, 5, 6] (blues), c = [1, 7] shares its darkest with a.
const p = Palette.fromData({
  colors: [null, '#200000', '#800000', '#ff4040', '#000020', '#000080', '#4040ff', '#008000'],
  ramps: [
    { name: 'a', tones: [1, 2, 3] },
    { name: 'b', tones: [4, 5, 6] },
    { name: 'c', tones: [1, 7] },
  ],
});

describe('outer outline', () => {
  it('rings a sprite with the darkest tone of its ramp, orthogonally by default', () => {
    const sprite = grid(['.....', '.....', '..3..', '.....', '.....']);
    expect(rows(outline(sprite, p))).toEqual(['.....', '..1..', '.131.', '..1..', '.....']);
    expect(rows(outline(sprite, p, { diagonal: true }))).toEqual(['.....', '.111.', '.131.', '.111.', '.....']);
  });

  it('follows the material it touches (selective outline)', () => {
    const sprite = grid(['......', '.33.66', '......']);
    const darker = p.lightnessOf(1) < p.lightnessOf(4) ? '1' : '4';
    expect(rows(outline(sprite, p))).toEqual(['.11.44', `133${darker}66`, '.11.44']);
  });

  it('picks the darkest outline where two materials meet the same pixel', () => {
    const out = outline(grid(['...', '3.6', '...']), p);
    const darker = p.lightnessOf(1) < p.lightnessOf(4) ? 1 : 4;
    expect(out.get(1, 1)).toBe(darker);
  });

  it('clips at the buffer edge', () => {
    expect(rows(outline(grid(['3.', '..']), p))).toEqual(['31', '1.']);
  });

  it('skips the listed ramps', () => {
    expect(rows(outline(grid(['...', '.3.', '...']), p, { skip: ['a'] }))).toEqual(['...', '.3.', '...']);
  });
});

describe('inner outline', () => {
  it('draws a line on the lighter side where unrelated materials meet', () => {
    const sprite = grid(['.....', '.3366', '.3366', '.....']);
    const lighterIsA = p.lightnessOf(3) > p.lightnessOf(6);
    const out = rows(outline(sprite, p, { inner: true }));
    expect(out[1]).toBe(lighterIsA ? '13166' : '13346');
    expect(out[2]).toBe(lighterIsA ? '13166' : '13346');
  });

  it('draws nothing inside one material or between ramps that share a colour', () => {
    const shading = grid(['.....', '.1233', '.....']);
    expect(rows(outline(shading, p, { inner: true }))[1]).toBe('11233');
    const shared = grid(['....', '.17.', '....']);
    expect(rows(outline(shared, p, { inner: true }))[1]).toBe('1171');
  });
});
