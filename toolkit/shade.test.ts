import { describe, expect, it } from 'vitest';
import { FloatField, IndexedBuffer } from '../core/buffer';
import { direction } from './light';
import { masterPalette } from './palette';
import { shade } from './shade';

const palette = masterPalette();
const rock = palette.ramp('rock').indices;

function sphere(size: number, r: number, offset = 0): [FloatField, IndexedBuffer] {
  const heights = new FloatField(size, size);
  const mats = new IndexedBuffer(size, size);
  const c = offset + r + 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        heights.set(x, y, Math.sqrt(r * r - d2));
        mats.set(x, y, 1);
      }
    }
  }
  return [heights, mats];
}

function flat(w: number, h: number): [FloatField, IndexedBuffer] {
  return [new FloatField(w, h), new IndexedBuffer(w, h).fill(1)];
}

describe('shade', () => {
  it('lights a flat face evenly: top tone facing the light, second tone facing away', () => {
    const [heights, mats] = flat(6, 4);
    const lit = shade(heights, mats, [{ ramp: 'rock' }], palette, { light: direction(0, 0, 1) });
    expect(new Set(lit.data)).toEqual(new Set([rock[rock.length - 1]]));
    const dark = shade(heights, mats, [{ ramp: 'rock' }], palette, { light: direction(0, 0, -1) });
    expect(new Set(dark.data)).toEqual(new Set([rock[1]]));
    const noReserve = shade(heights, mats, [{ ramp: 'rock' }], palette, { light: direction(0, 0, -1), reserveDarkest: false });
    expect(new Set(noReserve.data)).toEqual(new Set([rock[0]]));
  });

  it('never dithers a flat face, even near a level boundary', () => {
    const [heights, mats] = flat(8, 8);
    for (let z = 0.05; z < 1; z += 0.05) {
      const out = shade(heights, mats, [{ ramp: 'rock' }], palette, { light: direction(Math.sqrt(1 - z * z), 0, z) });
      expect(new Set(out.data).size).toBe(1);
    }
  });

  it('keeps emissive materials lit on the shadow side', () => {
    const [heights, mats] = flat(2, 2);
    const out = shade(heights, mats, [{ ramp: 'energy', emissive: 2 }], palette, { light: direction(0, 0, -1) });
    expect(out.get(0, 0)).toBe(palette.index('energy', 3));
  });

  it('uses only the tones of each pixel material and leaves empty pixels transparent', () => {
    const [heights, mats] = sphere(24, 10);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 24; x++) if (mats.get(x, y) === 1) mats.set(x, y, 2);
    const out = shade(heights, mats, [{ ramp: 'rock' }, { ramp: 'magma' }], palette, { light: direction(-1, -1, 1) });
    const magma = palette.ramp('magma').indices;
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < 24; x++) {
        const m = mats.get(x, y);
        const v = out.get(x, y);
        if (m === 0) expect(v).toBe(0);
        else expect([...(m === 1 ? rock : magma)]).toContain(v);
      }
    }
  });

  it('shades a sphere into several levels and dithers its gradients', () => {
    const [heights, mats] = sphere(24, 10);
    const light = direction(-1, -1, 1);
    const plain = shade(heights, mats, [{ ramp: 'rock' }], palette, { light, dither: null });
    const dithered = shade(heights, mats, [{ ramp: 'rock' }], palette, { light });
    expect(new Set(plain.data).size).toBeGreaterThanOrEqual(4);
    expect(dithered.data).not.toEqual(plain.data);
    expect(shade(heights, mats, [{ ramp: 'rock' }], palette, { light }).data).toEqual(dithered.data);
  });

  it('anchors the dither to the sprite: the same sprite shaded anywhere looks the same', () => {
    const light = direction(1, -1, 1);
    const [h1, m1] = sphere(24, 10);
    const [h2, m2] = sphere(40, 10, 12);
    const a = shade(h1, m1, [{ ramp: 'ocean' }], palette, { light });
    const b = shade(h2, m2, [{ ramp: 'ocean' }], palette, { light }).crop(12, 12, 24, 24);
    expect(b.data).toEqual(a.data);
  });

  it('validates its inputs', () => {
    const [heights, mats] = flat(2, 2);
    expect(() => shade(new FloatField(3, 2), mats, [{ ramp: 'rock' }], palette, { light: direction(0, 0, 1) })).toThrow(RangeError);
    expect(() => shade(heights, mats.fill(2), [{ ramp: 'rock' }], palette, { light: direction(0, 0, 1) })).toThrow(RangeError);
  });
});
