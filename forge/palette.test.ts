import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oklabToOklch } from '../toolkit/color';
import { buildPalette, formatPalette, rampTones, type PaletteParams } from './palette';

const params = JSON.parse(readFileSync('style/ramps.json', 'utf8')) as PaletteParams;

describe('palette builder', () => {
  it('reproduces the committed style/palette.json exactly', () => {
    const committed = readFileSync('style/palette.json', 'utf8');
    expect(formatPalette(buildPalette(params).data)).toBe(committed);
  });

  it('formats valid JSON that parses back to the same data', () => {
    const { data } = buildPalette(params);
    expect(JSON.parse(formatPalette(data))).toEqual(data);
  });

  it('builds ramps that get lighter, cooler in the shadows and warmer in the highlights', () => {
    const ramp = { name: 'test', hue: 140, chroma: 0.12, lightness: [0.3, 0.8] as [number, number], tones: 5, hueShift: 30 };
    const tones = rampTones(ramp, params).map((lab) => oklabToOklch(lab));
    for (let t = 1; t < tones.length; t++) expect(tones[t][0]).toBeGreaterThan(tones[t - 1][0]);
    expect(tones[0][2]).toBeCloseTo(170, 6);
    expect(tones[2][2]).toBeCloseTo(140, 6);
    expect(tones[4][2]).toBeCloseTo(110, 6);
  });

  it('fails loudly when the ramps cannot fit', () => {
    expect(() => buildPalette({ ...params, maxColors: 40 })).toThrow(/cannot fit/);
    expect(() => buildPalette({ ...params, ramps: [{ ...params.ramps[0], tones: 7 }] })).toThrow(/tones must be 4-6/);
  });
});
