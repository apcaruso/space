// Ordered (Bayer) dithering. Thresholds are looked up with the object's own pixel coordinates,
// so the pattern travels with the sprite instead of swimming against the screen.

export interface BayerMatrix {
  readonly size: number;
  /** size - 1: coordinates wrap with `& mask`, negative ones included. */
  readonly mask: number;
  /** Thresholds (rank + 0.5) / size^2 in (0, 1), row-major. */
  readonly thresholds: Float64Array;
}

/** Bayer rank matrix by recursive doubling: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]]. */
function ranks(size: number): number[] {
  if (size === 1) return [0];
  const half = size / 2;
  const inner = ranks(half);
  const out = new Array<number>(size * size);
  const offsets = [0, 2, 3, 1];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const quadrant = (y >= half ? 2 : 0) + (x >= half ? 1 : 0);
      out[y * size + x] = 4 * inner[(y % half) * half + (x % half)] + offsets[quadrant];
    }
  }
  return out;
}

export function bayerMatrix(size: 2 | 4 | 8): BayerMatrix {
  const n = size * size;
  return { size, mask: size - 1, thresholds: Float64Array.from(ranks(size), (r) => (r + 0.5) / n) };
}

export const BAYER2 = bayerMatrix(2);
export const BAYER4 = bayerMatrix(4);
export const BAYER8 = bayerMatrix(8);

/** Threshold in (0, 1) for the object-local pixel (x, y). */
export function bayerThreshold(m: BayerMatrix, x: number, y: number): number {
  return m.thresholds[(y & m.mask) * m.size + (x & m.mask)];
}

/**
 * Quantises a continuous level `v` to an integer. Boundaries sit at integer values of `v`;
 * `threshold` (0.5 = no dither) decides pixels near a boundary, over a band of `width` levels
 * around it: 1 dithers the whole range between level centres, 0 gives hard bands.
 */
export function ditherQuantize(v: number, threshold: number, width = 1): number {
  const u = v - 0.5;
  const base = Math.floor(u);
  let f = u - base;
  if (width < 1) {
    f = width <= 0 ? (f >= 0.5 ? 1 : 0) : (f - 0.5) / width + 0.5;
    f = f < 0 ? 0 : f > 1 ? 1 : f;
  }
  return f + threshold >= 1 ? base + 1 : base;
}
