// Size steps: sprites are generated only at these sizes and drawn 1:1, so zooming never scales
// pixels. Each step is about 20% larger than the previous one.

import { log, pow } from '../core/dmath';

export const STEP_RATIO = 1.2;

/** Sizes from min to max (both included), about STEP_RATIO apart, strictly increasing. */
export function sizeSteps(min: number, max: number): number[] {
  const out = [min];
  for (let k = 1; ; k++) {
    const next = Math.round(min * pow(STEP_RATIO, k));
    if (next >= max) break;
    if (next > out[out.length - 1]) out.push(next);
  }
  if (out[out.length - 1] !== max) out.push(max);
  return out;
}

/** Index of the step closest to `size` on a logarithmic scale; clamped to the ends. */
export function nearestStep(steps: readonly number[], size: number): number {
  if (size <= steps[0]) return 0;
  if (size >= steps[steps.length - 1]) return steps.length - 1;
  const target = log(size);
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    const d = Math.abs(log(steps[i]) - target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

const cache = new Map<string, number[]>();

/** Memoised steps for a generator's size range. */
export function stepsFor(min: number, max: number): readonly number[] {
  const key = `${min}|${max}`;
  let steps = cache.get(key);
  if (steps === undefined) {
    steps = sizeSteps(min, max);
    cache.set(key, steps);
  }
  return steps;
}

/** The step size for a desired on-screen size. */
export function stepSize(min: number, max: number, size: number): number {
  const steps = stepsFor(min, max);
  return steps[nearestStep(steps, size)];
}
