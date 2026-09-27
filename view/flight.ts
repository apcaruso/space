// Camera flights: the smooth zoom-and-pan path of van Wijk and Nuij ("Smooth and efficient zooming
// and panning", 2003). Far targets are reached by zooming out, moving, and zooming in, at a speed
// that feels constant on screen.

import { exp, LN2, log } from '../core/dmath';
import { delta, normalize } from '../universe/coords';
import { SCREEN_W, zoomScale, type Camera } from './camera';

const RHO = 1.41;

const cosh = (x: number) => (exp(x) + exp(-x)) / 2;
const sinh = (x: number) => (exp(x) - exp(-x)) / 2;
const tanh = (x: number) => {
  if (x > 20) return 1;
  if (x < -20) return -1;
  const e2 = exp(2 * x);
  return (e2 - 1) / (e2 + 1);
};

export class Flight {
  readonly duration: number;
  private readonly from: Camera;
  private readonly to: Camera;
  private readonly ux: number;
  private readonly uy: number;
  private readonly u1: number;
  private readonly w0: number;
  private readonly w1: number;
  private readonly r0: number;
  private readonly S: number;
  private readonly still: boolean;
  private elapsed = 0;

  constructor(from: Camera, to: Camera) {
    this.from = from;
    this.to = to;
    const [dx, dy] = delta(from.center, to.center);
    this.u1 = Math.sqrt(dx * dx + dy * dy);
    this.ux = this.u1 > 0 ? dx / this.u1 : 0;
    this.uy = this.u1 > 0 ? dy / this.u1 : 0;
    this.w0 = SCREEN_W / zoomScale(from.z);
    this.w1 = SCREEN_W / zoomScale(to.z);
    const r2 = RHO * RHO;
    this.still = this.u1 < 1e-9 * Math.min(this.w0, this.w1);
    if (this.still) {
      this.r0 = 0;
      this.S = Math.abs(log(this.w1 / this.w0)) / RHO;
    } else {
      const b0 = (this.w1 * this.w1 - this.w0 * this.w0 + r2 * r2 * this.u1 * this.u1) / (2 * this.w0 * r2 * this.u1);
      const b1 = (this.w1 * this.w1 - this.w0 * this.w0 - r2 * r2 * this.u1 * this.u1) / (2 * this.w1 * r2 * this.u1);
      this.r0 = log(-b0 + Math.sqrt(b0 * b0 + 1));
      const r1 = log(-b1 + Math.sqrt(b1 * b1 + 1));
      this.S = (r1 - this.r0) / RHO;
    }
    // About half a second per unit of path, within reason.
    this.duration = Math.round(Math.min(3500, Math.max(450, this.S * 420)));
  }

  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  /** Advances by `ms` and returns the camera on the path. */
  advance(ms: number): Camera {
    this.elapsed = Math.min(this.duration, this.elapsed + ms);
    const t = this.elapsed / this.duration;
    const e = t * t * (3 - 2 * t);
    if (this.done) return this.to;
    const s = e * this.S;
    let u: number;
    let w: number;
    if (this.still) {
      u = 0;
      w = this.w0 * exp((this.w1 > this.w0 ? 1 : -1) * RHO * s);
    } else {
      u = (this.w0 / (RHO * RHO)) * (cosh(this.r0) * tanh(RHO * s + this.r0) - sinh(this.r0));
      w = (this.w0 * cosh(this.r0)) / cosh(RHO * s + this.r0);
    }
    const c = this.from.center;
    const z = log(SCREEN_W / w) / LN2;
    return { center: normalize(c.sx, c.sy, c.x + this.ux * u, c.y + this.uy * u), z };
  }
}
