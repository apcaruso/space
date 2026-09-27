// Orbits on rails: positions are closed-form functions of the integer tick (Kepler's equation
// solved with a fixed number of Newton steps), never an incremental simulation.

import { cos, PI, pow, sin, TAU } from '../core/dmath';

/** One tick is one hour of game time. */
export const TICKS_PER_YEAR = 8766;

export interface Orbit {
  /** Semi-major axis (AU around stars, planet radii around planets). */
  readonly a: number;
  readonly e: number;
  /** Argument of periapsis, radians. */
  readonly omega: number;
  /** Period in ticks, >= 1. */
  readonly period: number;
  /** Ticks already elapsed at tick 0, in [0, period). */
  readonly phase: number;
}

/** Eccentric anomaly E for mean anomaly M: solves E - e sin E = M. */
export function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : PI;
  for (let i = 0; i < 12; i++) E -= (E - e * sin(E) - M) / (1 - e * cos(E));
  return E;
}

/** Fraction of the orbit completed at `tick`, via integer modulo so precision never degrades. */
export function orbitPhase(o: Orbit, tick: number): number {
  const m = (((tick % o.period) + o.period) % o.period + o.phase) % o.period;
  return m / o.period;
}

/** Position at `tick`, relative to the focus, in the units of `a`; x right, y down. */
export function orbitPosition(o: Orbit, tick: number): { x: number; y: number } {
  const E = solveKepler(TAU * orbitPhase(o, tick), o.e);
  const px = o.a * (cos(E) - o.e);
  const py = o.a * Math.sqrt(1 - o.e * o.e) * sin(E);
  const c = cos(o.omega);
  const s = sin(o.omega);
  return { x: px * c - py * s, y: px * s + py * c };
}

/** Kepler's third law: period in ticks for semi-major axis `a` (AU) around `mass` solar masses. */
export function periodTicks(a: number, mass: number): number {
  return Math.max(1, Math.round((TICKS_PER_YEAR * pow(a, 1.5)) / Math.sqrt(mass)));
}

/** Closest and farthest distance from the focus. */
export function periapsis(o: Orbit): number {
  return o.a * (1 - o.e);
}

export function apoapsis(o: Orbit): number {
  return o.a * (1 + o.e);
}
