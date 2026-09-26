// Integer hashing and seed derivation. Seeds are uint32; every function returns a uint32.

/** murmur3 fmix32 finalizer: a bijection on uint32 with full avalanche. */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      h = Math.imul(h ^ c, 0x01000193);
      continue;
    }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        i++;
      }
    }
    if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >>> 6)), 0x01000193);
    } else if (c < 0x10000) {
      h = Math.imul(h ^ (0xe0 | (c >>> 12)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >>> 6) & 0x3f)), 0x01000193);
    } else {
      h = Math.imul(h ^ (0xf0 | (c >>> 18)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >>> 12) & 0x3f)), 0x01000193);
      h = Math.imul(h ^ (0x80 | ((c >>> 6) & 0x3f)), 0x01000193);
    }
    h = Math.imul(h ^ (0x80 | (c & 0x3f)), 0x01000193);
  }
  return h >>> 0;
}

// Distinct tags keep derive(s, "7") and derive(s, 7) apart.
const TAG_STRING = 0x9e3779b9;
const TAG_INT_LO = 0x7f4a7c15;
const TAG_INT_HI = 0x2c1b3c6d;

// For a fixed h, word -> result is a bijection: distinct parts under one parent never collide.
function absorb(h: number, word: number, tag: number): number {
  return mix32(h ^ mix32((word + tag) | 0));
}

/**
 * Derives a child seed from `seed` and a path of names and integer indices:
 * `derive(galaxy, "sector", x, y)`. Hierarchical: `derive(derive(s, a), b) === derive(s, a, b)`.
 * Numbers must be safe integers (negative allowed) and are hashed as 64-bit two's complement.
 * Not meant for inner loops: derive seeds once, outside per-pixel code.
 */
export function derive(seed: number, ...parts: readonly (number | string)[]): number {
  let h = seed >>> 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (typeof part === 'string') {
      h = absorb(h, hashString(part), TAG_STRING);
    } else {
      if (!Number.isSafeInteger(part)) throw new RangeError(`derive: ${part} is not a safe integer`);
      h = absorb(h, part >>> 0, TAG_INT_LO);
      h = absorb(h, Math.floor(part / 4294967296) | 0, TAG_INT_HI);
    }
  }
  return h;
}

// hashCoords in three stages, so noise can share the x and y prefixes between cell corners.
// hashCoords(s, x, y, z) === hashStageZ(hashStageY(hashStageX(s, x), y), z).

export function hashStageX(seed: number, x: number): number {
  const h = seed ^ Math.imul(x | 0, 0x27d4eb2f);
  return Math.imul(h ^ (h >>> 15), 0x85ebca77);
}

export function hashStageY(h: number, y: number): number {
  h ^= Math.imul(y | 0, 0x165667b1);
  return Math.imul(h ^ (h >>> 13), 0xc2b2ae3d);
}

export function hashStageZ(h: number, z: number): number {
  return mix32(h ^ Math.imul(z | 0, 0x9e3779b1));
}

/**
 * Hash of an integer lattice point, for noise. Coordinates are taken modulo 2^32.
 * Allocation-free and cheap enough for millions of calls; 2D callers omit `z`.
 */
export function hashCoords(seed: number, x: number, y: number, z = 0): number {
  return hashStageZ(hashStageY(hashStageX(seed, x), y), z);
}
