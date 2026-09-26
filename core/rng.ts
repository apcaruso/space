import { mix32 } from './hash';

/**
 * sfc32 pseudo-random generator for sequences inside a single subsystem.
 *
 * Always construct it from a derived seed (`new Rng(derive(seed, "craters"))`) and never share
 * an instance between subsystems: with a shared sequence, adding a draw in one feature would
 * shift every feature that draws after it (determinism rule 3).
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    const s = seed >>> 0;
    this.a = mix32(s ^ 0x9e3779b9);
    this.b = mix32(s ^ 0x243f6a88);
    this.c = mix32(s ^ 0xb7e15162);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Next uint32. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (((this.c << 21) | (this.c >>> 11)) + t) | 0;
    return t >>> 0;
  }

  /** Float in [0, 1), 32-bit resolution. */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Integer in [min, max], both inclusive. The span must not exceed 2^32. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** Float in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.float();
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** A uniformly chosen element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)];
  }

  /** Fisher-Yates shuffle, in place. Returns the same array. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }
}
