import { describe, expect, it } from 'vitest';
import {
  clipChroma,
  hexToRgb8,
  inGamut,
  oklabToOklch,
  oklabToRgb8,
  oklchToOklab,
  rgb8ToHex,
  rgb8ToOklab,
  type Rgb8,
} from './color';

describe('OKLab', () => {
  it('maps white and black to the ends of the lightness axis', () => {
    const white = rgb8ToOklab([255, 255, 255]);
    expect(white[0]).toBeCloseTo(1, 4);
    expect(Math.abs(white[1])).toBeLessThan(1e-4);
    expect(Math.abs(white[2])).toBeLessThan(1e-4);
    expect(rgb8ToOklab([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('round-trips 8-bit sRGB', () => {
    for (let r = 0; r < 256; r += 15) {
      for (let g = 0; g < 256; g += 15) {
        for (let b = 0; b < 256; b += 15) {
          const rgb: Rgb8 = [r, g, b];
          expect(oklabToRgb8(rgb8ToOklab(rgb))).toEqual(rgb);
        }
      }
    }
  });

  it('orders greys by lightness', () => {
    let prev = -1;
    for (let v = 0; v < 256; v += 5) {
      const L = rgb8ToOklab([v, v, v])[0];
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
  });

  it('converts between OKLab and OKLCH', () => {
    const lab = oklchToOklab(0.6, 0.1, 140);
    const [L, C, h] = oklabToOklch(lab);
    expect(L).toBeCloseTo(0.6, 12);
    expect(C).toBeCloseTo(0.1, 12);
    expect(h).toBeCloseTo(140, 9);
    expect(oklabToOklch(oklchToOklab(0.5, 0.05, 350))[2]).toBeCloseTo(350, 9);
  });
});

describe('clipChroma', () => {
  it('leaves in-gamut colours alone', () => {
    const lab = rgb8ToOklab([120, 80, 200]);
    expect(clipChroma(lab)).toEqual(lab);
  });

  it('brings out-of-gamut colours in, keeping lightness and hue', () => {
    const wild = oklchToOklab(0.9, 0.4, 140);
    expect(inGamut(wild)).toBe(false);
    const clipped = clipChroma(wild);
    expect(inGamut(clipped)).toBe(true);
    const [L, C, h] = oklabToOklch(clipped);
    expect(L).toBeCloseTo(0.9, 12);
    expect(h).toBeCloseTo(140, 6);
    expect(C).toBeLessThan(0.4);
    expect(C).toBeGreaterThan(0.05);
  });
});

describe('hex', () => {
  it('round-trips and validates', () => {
    expect(rgb8ToHex([1, 171, 255])).toBe('#01abff');
    expect(hexToRgb8('#01abff')).toEqual([1, 171, 255]);
    expect(() => hexToRgb8('#01ABFF')).toThrow(RangeError);
    expect(() => hexToRgb8('01abff')).toThrow(RangeError);
  });
});
