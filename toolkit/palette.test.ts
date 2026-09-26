import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../core/buffer';
import { hexToRgb8, rgb8ToOklab } from './color';
import { applyTable, composeTables, masterPalette, Palette, type PaletteData } from './palette';

const REQUIRED_RAMPS = [
  'space', 'ocean', 'coast', 'vegetation', 'rock', 'sand', 'ice', 'magma', 'basalt', 'ash',
  'gas-warm', 'gas-cold', 'gas-violet', 'cloud', 'metal-light', 'metal-dark', 'metal-ancient',
  'energy', 'aurora', 'crystal-magenta', 'crystal-teal', 'ui-cool', 'ui-warm',
];

// Two ramps of three tones plus a third that shares its darkest colour with "a".
const SMALL: PaletteData = {
  colors: [null, '#200000', '#800000', '#ff4040', '#000020', '#000080', '#4040ff', '#008000'],
  ramps: [
    { name: 'a', tones: [1, 2, 3] },
    { name: 'b', tones: [4, 5, 6] },
    { name: 'c', tones: [1, 7] },
  ],
};

describe('master palette', () => {
  const palette = masterPalette();
  const hexes = palette.size;

  it('has 48-63 opaque colours after the transparent index 0', () => {
    expect(hexes - 1).toBeGreaterThanOrEqual(48);
    expect(hexes - 1).toBeLessThanOrEqual(63);
    const rgba = palette.toRGBA(new IndexedBuffer(1, 1));
    expect(rgba[3]).toBe(0);
  });

  it('has no duplicate colours and uses every colour in some ramp', () => {
    const seen = new Set<string>();
    const used = new Set<number>();
    for (const ramp of palette.ramps) for (const i of ramp.indices) used.add(i);
    const buf = new IndexedBuffer(hexes, 1);
    for (let i = 0; i < hexes; i++) buf.set(i, 0, i);
    const rgba = palette.toRGBA(buf);
    for (let i = 1; i < hexes; i++) {
      const key = `${rgba[i * 4]},${rgba[i * 4 + 1]},${rgba[i * 4 + 2]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(used.has(i)).toBe(true);
    }
  });

  it('has every required ramp, each with 4-6 tones', () => {
    expect(palette.ramps.map((r) => r.name)).toEqual(REQUIRED_RAMPS);
    for (const ramp of palette.ramps) {
      expect(ramp.indices.length).toBeGreaterThanOrEqual(4);
      expect(ramp.indices.length).toBeLessThanOrEqual(6);
    }
  });

  it('orders every ramp by lightness, with visible steps', () => {
    for (const ramp of palette.ramps) {
      for (let t = 1; t < ramp.indices.length; t++) {
        const step = palette.lightnessOf(ramp.indices[t]) - palette.lightnessOf(ramp.indices[t - 1]);
        expect(step, `${ramp.name} tone ${t}`).toBeGreaterThan(0.04);
      }
    }
  });

  it('gives every ramp a key tone of its own and caps sharing between ramps', () => {
    const owners = new Map<number, number>();
    for (const ramp of palette.ramps) for (const i of ramp.indices) owners.set(i, (owners.get(i) ?? 0) + 1);
    for (const ramp of palette.ramps) {
      const key = ramp.indices[Math.floor(ramp.indices.length / 2)];
      expect(owners.get(key), `${ramp.name} key tone`).toBe(1);
    }
    for (let a = 0; a < palette.ramps.length; a++) {
      for (let b = a + 1; b < palette.ramps.length; b++) {
        const shared = [...palette.ramps[a].indices].filter((i) => palette.ramps[b].indices.includes(i));
        expect(shared.length, `${palette.ramps[a].name} / ${palette.ramps[b].name}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('Palette.fromData', () => {
  it('rejects malformed data', () => {
    const bad = (patch: Partial<PaletteData>) => () => Palette.fromData({ ...SMALL, ...patch });
    expect(bad({ colors: ['#000000', '#111111'] })).toThrow(RangeError);
    expect(bad({ colors: [null, '#GGGGGG'] })).toThrow(RangeError);
    expect(bad({ ramps: [{ name: 'a', tones: [1, 9] }] })).toThrow(RangeError);
    expect(bad({ ramps: [{ name: 'a', tones: [0, 1] }] })).toThrow(RangeError);
    expect(bad({ ramps: [{ name: 'a', tones: [1, 1] }] })).toThrow(RangeError);
    expect(bad({ ramps: [{ name: 'a', tones: [1, 2] }, { name: 'a', tones: [3, 4] }] })).toThrow(RangeError);
    expect(() => Palette.fromData(null)).toThrow(RangeError);
  });
});

describe('Palette lookups', () => {
  const p = Palette.fromData(SMALL);

  it('looks up (ramp, tone) with clamping', () => {
    expect(p.index('a', 0)).toBe(1);
    expect(p.index('a', 2)).toBe(3);
    expect(p.index('a', 9)).toBe(3);
    expect(p.index('b', -1)).toBe(4);
    expect(p.darkest('b')).toBe(4);
    expect(() => p.ramp('nope')).toThrow(RangeError);
  });

  it('knows the home ramp, tone and relations of every index', () => {
    expect(p.homeRamp(1)?.name).toBe('a');
    expect(p.homeRamp(7)?.name).toBe('c');
    expect(p.homeRamp(0)).toBeUndefined();
    expect(p.toneOf(6)).toBe(2);
    expect(p.related(2, 3)).toBe(true);
    expect(p.related(7, 1)).toBe(true);
    expect(p.related(7, 2)).toBe(false);
    expect(p.related(2, 5)).toBe(false);
    expect(p.darkestIndices()).toEqual([1, 4]);
  });

  it('converts to RGBA with transparent 0 and magenta for unknown indices', () => {
    const buf = new IndexedBuffer(3, 1, new Uint8Array([0, 3, 200]));
    const expected = [0, 0, 0, 0, ...hexToRgb8('#ff4040'), 255, 255, 0, 255, 255];
    expect([...p.toRGBA(buf)]).toEqual(expected);
  });

  it('stores OKLab lightness per index', () => {
    expect(p.lightnessOf(3)).toBeCloseTo(rgb8ToOklab(hexToRgb8('#ff4040'))[0], 12);
    expect(p.lightnessOf(0)).toBe(0);
  });
});

describe('index tables', () => {
  const p = Palette.fromData(SMALL);
  const sprite = new IndexedBuffer(4, 2, new Uint8Array([0, 1, 2, 3, 3, 2, 1, 7]));

  it('swaps a ramp for another and back', () => {
    const there = applyTable(sprite, p.swapTable('a', 'b'));
    expect([...there.data]).toEqual([0, 4, 5, 6, 6, 5, 4, 7]);
    const back = applyTable(there, p.swapTable('b', 'a'));
    expect([...back.data]).toEqual([...sprite.data]);
  });

  it('round-trips swaps between equal-length ramps of the master palette', () => {
    const master = masterPalette();
    const buf = new IndexedBuffer(master.size, 1);
    for (let i = 0; i < master.size; i++) buf.set(i, 0, i);
    for (const [a, b] of [['ocean', 'magma'], ['sand', 'ice'], ['crystal-magenta', 'crystal-teal']]) {
      const from = master.ramp(a).indices;
      const there = applyTable(buf, master.swapTable(a, b));
      const back = applyTable(there, master.swapTable(b, a));
      for (const i of from) expect(back.get(i, 0)).toBe(i);
    }
  });

  it('scales swaps between ramps of different lengths', () => {
    const table = p.swapTable('a', 'c');
    expect([table[1], table[2], table[3]]).toEqual([1, 7, 7]);
  });

  it('cycles a ramp over frames', () => {
    const at = (frame: number, period = 1) => {
      const t = p.cycleTable('a', frame, { period });
      return [t[1], t[2], t[3]];
    };
    expect(at(0)).toEqual([1, 2, 3]);
    expect(at(1)).toEqual([2, 3, 1]);
    expect(at(2)).toEqual([3, 1, 2]);
    expect(at(3)).toEqual([1, 2, 3]);
    expect(at(-1)).toEqual([3, 1, 2]);
    expect(at(5, 2)).toEqual([3, 1, 2]);
    const partial = p.cycleTable('a', 1, { from: 1, to: 2 });
    expect([partial[1], partial[2], partial[3]]).toEqual([1, 3, 2]);
    expect(() => p.cycleTable('a', 0.5)).toThrow(RangeError);
  });

  it('lightens and darkens along the home ramp without touching transparency', () => {
    const lighter = p.lightTable(1);
    const darker = p.lightTable(-1);
    expect(lighter[0]).toBe(0);
    expect([lighter[1], lighter[2], lighter[3]]).toEqual([2, 3, 3]);
    expect([darker[4], darker[5], darker[6]]).toEqual([4, 4, 5]);
    expect(lighter[7]).toBe(7);
    const identity = p.lightTable(0);
    for (let i = 0; i < 256; i++) expect(identity[i]).toBe(i);
    const master = masterPalette();
    const deep = master.lightTable(-10);
    for (let i = 1; i < master.size; i++) expect(deep[i]).not.toBe(0);
  });

  it('composes tables', () => {
    const both = composeTables(p.swapTable('a', 'b'), p.lightTable(1));
    expect([both[1], both[2], both[3]]).toEqual([5, 6, 6]);
  });
});
