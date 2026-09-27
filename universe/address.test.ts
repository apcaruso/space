import { describe, expect, it } from 'vitest';
import { derive } from '../core/hash';
import { Rng } from '../core/rng';
import { AddressError, formatAddress, parseAddress, resolve, type Address, type BodyRef } from './address';
import { sampleSystems } from './census';
import { Galaxy } from './galaxy';

function randomAddress(rng: Rng): Address {
  const galaxy = rng.next();
  const depth = rng.int(0, 3);
  if (depth === 0) return { galaxy };
  const sector = { sx: rng.int(-2_000_000_000, 2_000_000_000), sy: rng.int(-300, 300) };
  if (depth === 1) return { galaxy, sector };
  const system = rng.int(0, 15);
  if (depth === 2) return { galaxy, sector, system };
  const kinds: BodyRef[] = [
    { kind: 'star', index: rng.int(0, 2) },
    { kind: 'planet', index: rng.int(0, 40) },
    { kind: 'planet', index: rng.int(0, 9), moon: rng.int(0, 5) },
    { kind: 'belt', index: rng.int(0, 1) },
    { kind: 'comet', index: rng.int(0, 2) },
  ];
  return { galaxy, sector, system, body: rng.pick(kinds) };
}

describe('addresses', () => {
  it('format to short link-safe strings', () => {
    const a: Address = { galaxy: 305419896, sector: { sx: -12, sy: 40 }, system: 3, body: { kind: 'planet', index: 2, moon: 1 } };
    expect(formatAddress(a)).toBe('51u7i0.-c.14.3.p2m1');
    expect(formatAddress({ galaxy: 0 })).toBe('0');
    expect(formatAddress({ galaxy: 0xffffffff, sector: { sx: 0, sy: -1 } })).toBe('1z141z3.0.-1');
  });

  it('round-trip: address -> string -> address', () => {
    const rng = new Rng(derive(6, 'addresses'));
    for (let i = 0; i < 5000; i++) {
      const a = randomAddress(rng);
      const s = formatAddress(a);
      expect(s).toMatch(/^[0-9a-z.-]+$/);
      expect(s.length).toBeLessThanOrEqual(32);
      expect(parseAddress(s)).toEqual(a);
      expect(formatAddress(parseAddress(s))).toBe(s);
    }
  });

  it('refuse malformed strings with readable messages', () => {
    const bad = ['', 'x!', '0.1', '0.1.2.3.p1.m2', '0.01.2', '0.-0.2', '0.1.2.3.q1', '0.1.2.3.s1m1', 'zzzzzzzzzzzz'];
    for (const s of bad) expect(() => parseAddress(s), s).toThrow(AddressError);
    expect(() => parseAddress('0.1.2.3.q1')).toThrow(/corpo non valido/);
    expect(() => parseAddress('0.1')).toThrow(/settore vuole due coordinate/);
    expect(parseAddress(' 51U7I0.-C.14 ')).toEqual({ galaxy: 305419896, sector: { sx: -12, sy: 40 } });
  });

  it('resolve deterministically to the objects they name', () => {
    const g = new Galaxy(0);
    for (const ref of sampleSystems(g, 40, 2)) {
      const base = { galaxy: 0, sector: { sx: ref.sx, sy: ref.sy }, system: ref.index };
      const r = resolve(parseAddress(formatAddress(base)), g);
      if (r.kind !== 'system') throw new Error('expected a system');
      expect(r.system.index).toBe(ref.index);
      expect(resolve(base)).toEqual(r);
      for (const p of r.system.planets) {
        const pr = resolve({ ...base, body: { kind: 'planet', index: p.index } }, g);
        expect(pr.kind === 'planet' && pr.planet.name).toBe(p.name);
        p.moons.forEach((m) => {
          const mr = resolve({ ...base, body: { kind: 'planet', index: p.index, moon: m.index } }, g);
          expect(mr.kind === 'moon' && mr.moon.name).toBe(m.name);
        });
      }
    }
  });

  it('refuse objects that do not exist', () => {
    const g = new Galaxy(0);
    const ref = sampleSystems(g, 1, 4)[0];
    const count = g.sector(ref.sx, ref.sy).count;
    const base = { galaxy: 0, sector: { sx: ref.sx, sy: ref.sy } };
    expect(() => resolve({ ...base, system: count }, g)).toThrow(/non esiste/);
    const sys = { ...base, system: ref.index };
    expect(() => resolve({ ...sys, body: { kind: 'planet', index: 30 } }, g)).toThrow(/pianeti/);
    expect(() => resolve({ ...sys, body: { kind: 'star', index: 5 } }, g)).toThrow(/stell/);
    expect(() => resolve({ galaxy: 0, sector: { sx: 999_999, sy: 0 }, system: 0 }, g)).toThrow(/ha 0 sistemi/);
    expect(() => resolve({ galaxy: 1 }, g)).toThrow(AddressError);
  });
});
