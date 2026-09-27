// Schematic geometry of a system in sector units, so the explorer has one continuous world from
// the galaxy down to a moon. Real distances span too many orders of magnitude: here a system
// fits in SYSTEM_RADIUS around its position, orbits follow a logarithmic radial scale, planets
// and moons get sizes that stay readable. Offsets are relative to the system's position.

import { cos, log, pow, sin, TAU } from '../core/dmath';
import { starClass } from '../gen/star/classes';
import { apoapsis, orbitPosition, periodTicks, type Orbit } from '../universe/orbit';
import type { StarSystem } from '../universe/system';

/** Radius of a system's layout: systems are at least 0.075 sectors apart, so they never overlap. */
export const SYSTEM_RADIUS = 0.03;
/** Radius of a Sun-like star; other classes scale like their sprites. */
const STAR_RADIUS = 0.0022;
/** Planet radius for one Earth radius, before the limit set by the neighbouring orbits. */
const PLANET_RADIUS = SYSTEM_RADIUS * 0.035;

/** Logarithmic radial scale: AU from the barycentre to sectors from the system's position. */
export class RadialScale {
  private readonly k: number;

  constructor(
    readonly inner: number,
    readonly outer: number,
    private readonly r0: number,
    rMax: number,
  ) {
    this.k = (outer - inner) / log(1 + rMax / r0);
  }

  world(au: number): number {
    return this.inner + this.k * log(1 + au / this.r0);
  }

  /** A point in AU (x right, y down) to a world offset, keeping its direction. */
  point(x: number, y: number): [number, number] {
    const r = Math.sqrt(x * x + y * y);
    if (r === 0) return [0, 0];
    const k = this.world(r) / r;
    return [x * k, y * k];
  }
}

export interface Offset {
  dx: number;
  dy: number;
}

export class SystemGeometry {
  readonly system: StarSystem;
  readonly scale: RadialScale;
  readonly starRadius: readonly number[];
  /** Distance of each star of the close pair from the centre (0 for a single star). */
  readonly pairOffset: number;
  readonly planetRadius: readonly number[];
  readonly moonRadius: readonly (readonly number[])[];
  readonly moonDistance: readonly (readonly number[])[];
  readonly belts: readonly { readonly inner: number; readonly outer: number }[];

  constructor(system: StarSystem) {
    this.system = system;
    this.starRadius = system.stars.map((s, k) => STAR_RADIUS * starClass(s.class).scale * (k === 2 ? 0.7 : 1));
    const pair = this.starRadius.slice(0, 2);
    this.pairOffset = system.stars.length > 1 ? Math.max(...pair) * 1.25 : 0;
    const inner = this.pairOffset + Math.max(...pair) * 1.9;

    let rMax = 0;
    let r0 = Infinity;
    for (const p of system.planets) {
      rMax = Math.max(rMax, apoapsis(p.orbit));
      r0 = Math.min(r0, p.orbit.a);
    }
    for (const b of system.belts) {
      rMax = Math.max(rMax, b.outer);
      r0 = Math.min(r0, b.inner);
    }
    if (rMax === 0) {
      rMax = system.habitable[1] * 2;
      r0 = system.habitable[0];
    }
    this.scale = new RadialScale(inner, SYSTEM_RADIUS, r0 * 0.5, rMax);

    // Planets as large as readable, but never wider than 70% of the gap to the next orbit.
    const orbits = system.planets.map((p) => this.scale.world(p.orbit.a));
    const edges = [inner, ...orbits, SYSTEM_RADIUS * 1.15];
    this.planetRadius = system.planets.map((p, n) => {
      const gap = Math.min(edges[n + 1] - edges[n], edges[n + 2] - edges[n + 1]);
      return Math.min(PLANET_RADIUS * pow(p.radius, 0.3), gap * 0.35);
    });
    this.moonRadius = system.planets.map((p, n) =>
      p.moons.map((m) => this.planetRadius[n] * Math.min(0.45, Math.max(0.1, 0.12 + 0.6 * Math.sqrt(m.radius / p.radius)))),
    );
    this.moonDistance = system.planets.map((p, n) => {
      const r = this.planetRadius[n];
      const biggest = Math.max(0, ...this.moonRadius[n]);
      const step = Math.max(0.9 * r, 2.3 * biggest);
      return p.moons.map((_, k) => r * (p.rings ? 2.6 : 1.8) + biggest + k * step);
    });
    this.belts = system.belts.map((b) => ({ inner: this.scale.world(b.inner), outer: this.scale.world(b.outer) }));
  }

  /** Outermost extent of the drawing, moons of the outer planets included. */
  get extent(): number {
    let e = SYSTEM_RADIUS;
    this.system.planets.forEach((p, n) => {
      const d = this.moonDistance[n];
      if (d.length > 0) e = Math.max(e, this.scale.world(apoapsis(p.orbit)) + d[d.length - 1] + this.moonRadius[n][d.length - 1]);
    });
    return e * (this.system.stars.length === 3 ? 1.15 : 1);
  }

  orbitPoint(o: Orbit, E: number): [number, number] {
    const b = o.a * Math.sqrt(1 - o.e * o.e);
    const px = o.a * (cos(E) - o.e);
    const py = b * sin(E);
    const c = cos(o.omega);
    const s = sin(o.omega);
    return this.scale.point(px * c - py * s, px * s + py * c);
  }

  star(k: number, tick: number): Offset {
    const s = this.system.stars[k];
    if (s.orbit === null) return { dx: 0, dy: 0 };
    const p = orbitPosition(s.orbit, tick);
    const r = Math.sqrt(p.x * p.x + p.y * p.y);
    if (r === 0) return { dx: 0, dy: 0 };
    // The close pair sits side by side around the centre; the far companion just outside.
    const d = k < 2 ? this.pairOffset : SYSTEM_RADIUS * 1.08;
    return { dx: (p.x / r) * d, dy: (p.y / r) * d };
  }

  planet(n: number, tick: number): Offset {
    const p = orbitPosition(this.system.planets[n].orbit, tick);
    const [dx, dy] = this.scale.point(p.x, p.y);
    return { dx, dy };
  }

  /** Moon offset from its planet's centre. */
  moon(n: number, m: number, tick: number): Offset {
    const o = orbitPosition(this.system.planets[n].moons[m].orbit, tick);
    const r = Math.sqrt(o.x * o.x + o.y * o.y) || 1;
    const d = this.moonDistance[n][m];
    return { dx: (o.x / r) * d, dy: (o.y / r) * d };
  }

  comet(c: number, tick: number): Offset {
    const p = orbitPosition(this.system.comets[c].orbit, tick);
    const [dx, dy] = this.scale.point(p.x, p.y);
    return { dx, dy };
  }

  /** Belt rotation angle at `tick`: the whole belt turns with the period at its middle. */
  beltAngle(b: number, tick: number): number {
    const belt = this.system.belts[b];
    const mid = (belt.inner + belt.outer) / 2;
    const period = periodTicks(mid, this.system.mass);
    return (TAU * (((tick % period) + period) % period)) / period;
  }
}
