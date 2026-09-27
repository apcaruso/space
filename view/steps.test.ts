import { describe, expect, it } from 'vitest';
import { nearestStep, sizeSteps, stepSize } from './steps';

describe('size steps', () => {
  it('grow by about 20% between min and max', () => {
    const steps = sizeSteps(8, 256);
    expect(steps[0]).toBe(8);
    expect(steps[steps.length - 1]).toBe(256);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
      const r = steps[i] / steps[i - 1];
      if (i < steps.length - 1) expect(r).toBeGreaterThan(1.1);
      expect(r).toBeLessThan(1.35);
    }
    expect(steps.length).toBeGreaterThan(15);
  });

  it('pick the nearest step on a log scale', () => {
    const steps = sizeSteps(8, 256);
    expect(steps[nearestStep(steps, 2)]).toBe(8);
    expect(steps[nearestStep(steps, 1000)]).toBe(256);
    expect(stepSize(8, 256, 24)).toBe(24);
    // Just below the midpoint between 20 and 24 (in log terms, 21.9) still picks 20.
    expect(stepSize(8, 256, 21.8)).toBe(20);
    expect(stepSize(8, 256, 22)).toBe(24);
  });
});
