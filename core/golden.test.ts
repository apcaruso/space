import { expect, it } from 'vitest';
import { FloatField, IndexedBuffer } from './buffer';
import * as dm from './dmath';
import { fingerprint, fingerprintBytes } from './fingerprint';
import { derive, hashCoords } from './hash';
import {
  createCellSample,
  Fbm2,
  Fbm3,
  gradientNoise2,
  gradientNoise3,
  valueNoise2,
  valueNoise3,
  Warp3,
  worley2,
  worley3,
} from './noise';
import { Rng } from './rng';

// Fingerprints of fixed core outputs. Any change to the bits fails this test: if the change is
// intended, bump the affected versions and regenerate with `npm test -- -u`.

const SIZE = 64;
const SEED = 20260926;
const Z = 0.37;

function field(f: (x: number, y: number) => number): FloatField {
  const out = new FloatField(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) out.set(x, y, f(x * 0.11 - 3.5, y * 0.11 + 7.25));
  }
  return out;
}

function u32Bytes(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v, true));
  return out;
}

function f64Bytes(values: readonly number[]): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setFloat64(i * 8, v, true));
  return out;
}

function goldens(): Record<string, string> {
  const s = (name: string) => derive(SEED, name);
  const cell = createCellSample();
  const entries: [string, string][] = [];
  const add = (name: string, value: string) => entries.push([name, value]);

  const hashes: number[] = [];
  for (let y = -16; y < 16; y++) for (let x = -16; x < 16; x++) hashes.push(hashCoords(s('hash'), x, y, x - y));
  add('hash.coords', fingerprintBytes(u32Bytes(hashes)));

  const derived: number[] = [];
  for (let i = -64; i < 64; i++) derived.push(derive(SEED, 'sector', i, -i * 3), derive(SEED, `name-${i}`));
  add('hash.derive', fingerprintBytes(u32Bytes(derived)));

  const rng = new Rng(s('rng'));
  const draws: number[] = [];
  for (let i = 0; i < 1024; i++) draws.push(rng.next());
  add('rng.next', fingerprintBytes(u32Bytes(draws)));

  const math: number[] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const x = (t - 0.5) * 200;
    math.push(dm.sin(x), dm.cos(x), dm.tan(x), dm.atan(x), dm.atan2(x, 50 - i));
    math.push(dm.asin(t * 2 - 1), dm.acos(t * 2 - 1), dm.exp(x), dm.log(t * 1e3 + 1e-9), dm.pow(t * 10, x / 20));
  }
  add('dmath', fingerprintBytes(f64Bytes(math)));

  add('noise.value2', fingerprint(field((x, y) => valueNoise2(s('value2'), x, y))));
  add('noise.value3', fingerprint(field((x, y) => valueNoise3(s('value3'), x, y, Z))));
  add('noise.gradient2', fingerprint(field((x, y) => gradientNoise2(s('gradient2'), x, y))));
  add('noise.gradient3', fingerprint(field((x, y) => gradientNoise3(s('gradient3'), x, y, Z))));

  const fbm2 = new Fbm2(gradientNoise2, s('fbm2'), { octaves: 5 });
  const fbm3 = new Fbm3(gradientNoise3, s('fbm3'), { octaves: 5, lacunarity: 2.1, gain: 0.55, frequency: 0.8 });
  const fbmValue = new Fbm3(valueNoise3, s('fbm3.value'), { octaves: 4 });
  add('noise.fbm2', fingerprint(field((x, y) => fbm2.sample(x, y))));
  add('noise.fbm3', fingerprint(field((x, y) => fbm3.sample(x, y, Z))));
  add('noise.fbm3.value', fingerprint(field((x, y) => fbmValue.sample(x, y, Z))));

  const warp = new Warp3(fbm3, s('warp3'), { amplitude: 1.5, octaves: 3 });
  add('noise.warp3', fingerprint(field((x, y) => warp.sample(x, y, Z))));

  add('noise.worley2.f1', fingerprint(field((x, y) => worley2(s('worley2'), x, y, cell).f1)));
  add('noise.worley2.f2-f1', fingerprint(field((x, y) => worley2(s('worley2'), x, y, cell, 0.8).f2 - cell.f1)));
  add('noise.worley3.f1', fingerprint(field((x, y) => worley3(s('worley3'), x, y, Z, cell).f1)));
  add('noise.worley3.f2-f1', fingerprint(field((x, y) => worley3(s('worley3'), x, y, Z, cell).f2 - cell.f1)));

  const cells = new IndexedBuffer(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) cells.set(x, y, worley2(s('cells'), x * 0.11, y * 0.11, cell).cell & 0xff);
  }
  add('noise.worley2.cell', fingerprint(cells));

  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return Object.fromEntries(entries);
}

it('matches tests/golden/core.json', async () => {
  const first = JSON.stringify(goldens(), null, 2);
  expect(JSON.stringify(goldens(), null, 2)).toBe(first);
  await expect(`${first}\n`).toMatchFileSnapshot('../tests/golden/core.json');
});
