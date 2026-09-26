import { describe, expect, it } from 'vitest';
import { FloatField, IndexedBuffer, TRANSPARENT } from './buffer';

/** Buffer from rows of digits, one character per pixel. */
function fromRows(rows: string[]): IndexedBuffer {
  const buf = new IndexedBuffer(rows[0].length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => buf.set(x, y, Number(c))));
  return buf;
}

function toRows(buf: IndexedBuffer): string[] {
  const rows: string[] = [];
  for (let y = 0; y < buf.h; y++) {
    let row = '';
    for (let x = 0; x < buf.w; x++) row += String(buf.get(x, y));
    rows.push(row);
  }
  return rows;
}

describe('IndexedBuffer', () => {
  it('starts transparent and validates its size', () => {
    const buf = new IndexedBuffer(3, 2);
    expect(buf.data).toEqual(new Uint8Array(6));
    expect(TRANSPARENT).toBe(0);
    expect(() => new IndexedBuffer(0, 2)).toThrow(RangeError);
    expect(() => new IndexedBuffer(2.5, 2)).toThrow(RangeError);
    expect(() => new IndexedBuffer(2, 2, new Uint8Array(3))).toThrow(RangeError);
  });

  it('gets and sets inside, clips outside', () => {
    const buf = new IndexedBuffer(4, 3);
    buf.set(1, 2, 7);
    buf.set(-1, 0, 9);
    buf.set(4, 0, 9);
    buf.set(0, 3, 9);
    expect(buf.get(1, 2)).toBe(7);
    expect(buf.get(-1, 0)).toBe(TRANSPARENT);
    expect(buf.get(0, 3)).toBe(TRANSPARENT);
    expect([...buf.data].filter((v) => v !== 0)).toEqual([7]);
  });

  it('fills', () => {
    expect(toRows(new IndexedBuffer(3, 2).fill(5))).toEqual(['555', '555']);
  });

  it('blits non-transparent pixels with clipping', () => {
    const src = fromRows(['12', '03']);
    expect(toRows(fromRows(['999', '999', '999']).blit(src, 1, 1))).toEqual(['999', '912', '993']);
    expect(toRows(fromRows(['999', '999']).blit(src, -1, -1))).toEqual(['399', '999']);
    expect(toRows(fromRows(['999', '999']).blit(src, 2, 1))).toEqual(['999', '991']);
    expect(toRows(fromRows(['999']).blit(src, 5, 5))).toEqual(['999']);
  });

  it('crops, padding outside regions with transparency', () => {
    const buf = fromRows(['123', '456', '789']);
    expect(toRows(buf.crop(1, 1, 2, 2))).toEqual(['56', '89']);
    expect(toRows(buf.crop(-1, -1, 3, 3))).toEqual(['000', '012', '045']);
    expect(toRows(buf.crop(2, 2, 2, 2))).toEqual(['90', '00']);
    expect(toRows(buf.crop(5, 5, 2, 1))).toEqual(['00']);
    expect(toRows(buf)).toEqual(['123', '456', '789']);
  });

  it('flips into new buffers', () => {
    const buf = fromRows(['123', '456']);
    expect(toRows(buf.flipX())).toEqual(['321', '654']);
    expect(toRows(buf.flipY())).toEqual(['456', '123']);
    expect(toRows(buf)).toEqual(['123', '456']);
  });
});

describe('FloatField', () => {
  it('stores float32 values', () => {
    const f = new FloatField(2, 2);
    f.set(1, 0, 0.1);
    expect(f.get(1, 0)).toBe(Math.fround(0.1));
    expect(() => new FloatField(2, 2, new Float32Array(5))).toThrow(RangeError);
  });

  it('clamps reads to the edge and ignores writes outside', () => {
    const f = new FloatField(3, 2);
    f.set(0, 0, 1);
    f.set(2, 1, 5);
    f.set(-1, 0, 9);
    f.set(3, 1, 9);
    expect(f.get(-5, -5)).toBe(1);
    expect(f.get(10, 10)).toBe(5);
    expect(f.get(2, -1)).toBe(0);
    expect([...f.data]).toEqual([1, 0, 0, 0, 0, 5]);
  });

  it('fills', () => {
    expect([...new FloatField(2, 1).fill(0.5).data]).toEqual([0.5, 0.5]);
  });
});
