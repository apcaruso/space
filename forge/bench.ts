// Core benchmarks, run with `npm run bench`. Plain Node through tsx, because `vitest bench`
// reported up to 3x slower times for the same code (see Decisioni in docs/DESIGN.md).

import { createCellSample, Fbm3, gradientNoise3, valueNoise3, worley2, worley3 } from '../core/noise';

const SIZE = 256;
const SCALE = 1 / 32;
const WARMUP = 5;
const RUNS = 30;
const out = new Float32Array(SIZE * SIZE);

interface Case {
  name: string;
  run: () => void;
}

function field(sample: (x: number, y: number) => number): () => void {
  return () => {
    for (let y = 0, i = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++, i++) out[i] = sample(x * SCALE, y * SCALE);
    }
  };
}

const gradient = new Fbm3(gradientNoise3, 42, { octaves: 5 });
const value = new Fbm3(valueNoise3, 42, { octaves: 5 });
const cell = createCellSample();

const cases: Case[] = [
  { name: 'fbm 5 octaves, gradient 3D', run: field((x, y) => gradient.sample(x, y, 0.5)) },
  { name: 'fbm 5 octaves, value 3D', run: field((x, y) => value.sample(x, y, 0.5)) },
  { name: 'worley 2D (F1, F2)', run: field((x, y) => worley2(42, x * 4, y * 4, cell).f1) },
  { name: 'worley 3D (F1, F2)', run: field((x, y) => worley3(42, x * 4, y * 4, 0.5, cell).f1) },
];

console.log(`${SIZE}x${SIZE} fields, ${RUNS} runs after ${WARMUP} warm-up runs\n`);
for (const c of cases) {
  for (let i = 0; i < WARMUP; i++) c.run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    c.run();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(RUNS / 2)];
  const perSample = (median * 1e6) / (SIZE * SIZE);
  console.log(`${c.name.padEnd(28)} median ${median.toFixed(1).padStart(6)} ms   min ${times[0].toFixed(1).padStart(6)} ms   ${perSample.toFixed(0).padStart(4)} ns/pixel`);
}
