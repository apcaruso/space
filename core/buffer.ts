// Pixel buffers. Coordinates are integers, origin top-left, row-major storage.

/** Palette index reserved for transparency in every IndexedBuffer. */
export const TRANSPARENT = 0;

function checkSize(w: number, h: number, length: number | undefined): void {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
    throw new RangeError(`buffer size must be positive integers, got ${w}x${h}`);
  }
  if (length !== undefined && length !== w * h) {
    throw new RangeError(`buffer data has ${length} elements, expected ${w * h}`);
  }
}

/**
 * Image of palette indices (0 = transparent). Drawing methods (set, fill, blit) mutate and
 * clip silently; transforms (crop, flipX, flipY) return a new buffer.
 */
export class IndexedBuffer {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number, data?: Uint8Array) {
    checkSize(w, h, data?.length);
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8Array(w * h);
  }

  /** Index at (x, y); TRANSPARENT outside the buffer. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
    return this.data[y * this.w + x];
  }

  /** Writes an index (0..255) at (x, y); ignored outside the buffer. */
  set(x: number, y: number, index: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = index;
  }

  fill(index: number): this {
    this.data.fill(index);
    return this;
  }

  /** Copies the non-transparent pixels of `src` with its top-left at (dx, dy), clipped. */
  blit(src: IndexedBuffer, dx: number, dy: number): this {
    const x0 = Math.max(0, -dx);
    const y0 = Math.max(0, -dy);
    const x1 = Math.min(src.w, this.w - dx);
    const y1 = Math.min(src.h, this.h - dy);
    for (let sy = y0; sy < y1; sy++) {
      const srcRow = sy * src.w;
      const dstRow = (sy + dy) * this.w + dx;
      for (let sx = x0; sx < x1; sx++) {
        const v = src.data[srcRow + sx];
        if (v !== TRANSPARENT) this.data[dstRow + sx] = v;
      }
    }
    return this;
  }

  /** New w x h buffer with the region at (x, y); parts outside this buffer are transparent. */
  crop(x: number, y: number, w: number, h: number): IndexedBuffer {
    const out = new IndexedBuffer(w, h);
    const x0 = Math.max(0, -x);
    const y0 = Math.max(0, -y);
    const x1 = Math.min(w, this.w - x);
    const y1 = Math.min(h, this.h - y);
    for (let oy = y0; oy < y1; oy++) {
      const start = (oy + y) * this.w + x;
      out.data.set(this.data.subarray(start + x0, start + x1), oy * w + x0);
    }
    return out;
  }

  /** New buffer mirrored left to right. */
  flipX(): IndexedBuffer {
    const out = new IndexedBuffer(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      const row = y * this.w;
      for (let x = 0; x < this.w; x++) out.data[row + x] = this.data[row + this.w - 1 - x];
    }
    return out;
  }

  /** New buffer mirrored top to bottom. */
  flipY(): IndexedBuffer {
    const out = new IndexedBuffer(this.w, this.h);
    for (let y = 0; y < this.h; y++) {
      out.data.set(this.data.subarray((this.h - 1 - y) * this.w, (this.h - y) * this.w), y * this.w);
    }
    return out;
  }
}

/** Scalar field for intermediate data (heights, distances, light). Values are stored as float32. */
export class FloatField {
  readonly w: number;
  readonly h: number;
  readonly data: Float32Array;

  constructor(w: number, h: number, data?: Float32Array) {
    checkSize(w, h, data?.length);
    this.w = w;
    this.h = h;
    this.data = data ?? new Float32Array(w * h);
  }

  /** Value at (x, y), with coordinates clamped to the edge. */
  get(x: number, y: number): number {
    const cx = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const cy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return this.data[cy * this.w + cx];
  }

  /** Writes a value at (x, y); ignored outside the field. */
  set(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.data[y * this.w + x] = value;
  }

  fill(value: number): this {
    this.data.fill(value);
    return this;
  }
}
