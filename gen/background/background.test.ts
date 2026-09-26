import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../../core/buffer';
import { masterPalette } from '../../toolkit/palette';
import { registry } from '../index';

const palette = masterPalette();
const chunk = (x: number, y: number, extra: object = {}, size = 64, frame = 0) =>
  registry.run('background', { chunk: { x, y }, ...extra }, 7, { size, frame });

describe('background generator', () => {
  it('meets without seams: four small chunks equal one big chunk', () => {
    for (const layer of ['all', 'nebula', 'far', 'mid', 'near']) {
      const big = chunk(0, 0, { layer, region: { galaxies: 3 } }, 128, 5).buffer;
      const glued = new IndexedBuffer(128, 128);
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) glued.blit(chunk(x, y, { layer, region: { galaxies: 3 } }, 64, 5).buffer, x * 64, y * 64);
      expect(glued.data, layer).toEqual(big.data);
    }
  });

  it('covers every pixel in "all" and leaves single layers transparent where empty', () => {
    expect(chunk(3, -2).buffer.data.includes(0)).toBe(false);
    for (const layer of ['nebula', 'far', 'mid', 'near']) expect(chunk(3, -2, { layer }).buffer.data.includes(0)).toBe(true);
  });

  it('follows the region parameters', () => {
    const count = (stars: number) => chunk(0, 0, { layer: 'mid', region: { stars } }, 256).descriptor.midStars as number;
    expect(count(2)).toBeGreaterThan(count(1));
    expect(count(0)).toBe(0);
    const empty = chunk(0, 0, { layer: 'nebula', region: { nebula: 0 } }).buffer;
    expect(empty.data.every((v) => v === 0)).toBe(true);
    const tealRamp = new Set(palette.ramp('crystal-teal').indices);
    const teal = chunk(1, 1, { layer: 'nebula', region: { nebula: 1, nebulaRamp: 'crystal-teal', accentRamp: 'crystal-teal' } }, 256).buffer;
    expect([...teal.data].some((v) => tealRamp.has(v))).toBe(true);
  });

  it('twinkles only through the twinkle ramp', () => {
    const twinkle = new Set(palette.ramp('metal-light').indices);
    const a = chunk(2, 2, { layer: 'near', region: { stars: 3 } }, 128, 0).buffer.data;
    const b = chunk(2, 2, { layer: 'near', region: { stars: 3 } }, 128, 6).buffer.data;
    let changed = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      changed++;
      expect(twinkle.has(a[i]) && twinkle.has(b[i])).toBe(true);
    }
    expect(changed).toBeGreaterThan(0);
  });
});
