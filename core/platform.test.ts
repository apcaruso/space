import { describe, expect, it } from 'vitest';

// Premises of the determinism rules: IEEE 754 basic operations and Math.sqrt are correctly
// rounded in every JS engine, so anything built only on them gives the same bits everywhere.
describe('platform assumptions', () => {
  it('rounds basic float operations exactly', () => {
    expect(0.1 + 0.2).toBe(0.30000000000000004);
    expect(1 / 3).toBe(0.3333333333333333);
    expect(Math.sqrt(2)).toBe(1.4142135623730951);
    expect(Math.fround(0.1)).toBe(0.10000000149011612);
  });

  it('wraps 32-bit integer arithmetic', () => {
    expect(Math.imul(0x9e3779b9, 0x85ebca6b) >>> 0).toBe(0xc10eda53);
    expect((0xffffffff + 1) >>> 0).toBe(0);
    expect(Math.clz32(1)).toBe(31);
  });

  it('keeps integer ticks exact up to 2^53', () => {
    const tick = Number.MAX_SAFE_INTEGER - 1;
    expect(tick + 1).toBe(Number.MAX_SAFE_INTEGER);
    expect(tick % 1000).toBe(990);
  });
});
