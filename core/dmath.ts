// Deterministic math: built only from + - * / and Math.sqrt (correctly rounded by IEEE 754),
// plus exact operations (Math.floor/round/abs, comparisons, exact bit reinterpretation), so every
// JS engine returns the same bits. Argument reduction and minimax polynomials follow fdlibm;
// accuracy is close to double precision (see dmath.test.ts), well beyond the 1e-7 target.

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;
export const E = 2.718281828459045;
export const LN2 = 0.6931471805599453;
export const LN10 = 2.302585092994046;
export const SQRT2 = 1.4142135623730951;
export const SQRT1_2 = 0.7071067811865476;

// --- sin, cos, tan -------------------------------------------------------------------------

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417; // first 33 bits of pi/2: n * PIO2_1 is exact for |n| < 2^20
const PIO2_1T = 6.07710050650619224932e-11; // pi/2 - PIO2_1

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}

/** cos on [-pi/4, pi/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
}

// reduce() returns x - n*pi/2 in [-pi/4, pi/4] and leaves n mod 4 here (single-threaded scratch).
let quadrant = 0;

function reduce(x: number): number {
  const n = Math.round(x * INV_PIO2);
  quadrant = n - 4 * Math.floor(n / 4);
  return x - n * PIO2_1 - n * PIO2_1T;
}

/** Sine. Accurate for |x| < 1e6; beyond that it stays deterministic but loses precision. */
export function sin(x: number): number {
  const r = reduce(x);
  switch (quadrant) {
    case 0: return kernelSin(r);
    case 1: return kernelCos(r);
    case 2: return -kernelSin(r);
    default: return -kernelCos(r);
  }
}

/** Cosine. Same domain notes as sin. */
export function cos(x: number): number {
  const r = reduce(x);
  switch (quadrant) {
    case 0: return kernelCos(r);
    case 1: return -kernelSin(r);
    case 2: return -kernelCos(r);
    default: return kernelSin(r);
  }
}

/** Tangent. Same domain notes as sin. */
export function tan(x: number): number {
  const r = reduce(x);
  const s = kernelSin(r);
  const c = kernelCos(r);
  return quadrant === 0 || quadrant === 2 ? s / c : -c / s;
}

// --- atan, atan2, asin, acos ---------------------------------------------------------------

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

/** Arctangent, result in [-pi/2, pi/2]. */
export function atan(x: number): number {
  const negative = x < 0;
  let t = negative ? -x : x;
  let id: number;
  if (t < 0.4375) {
    id = -1;
  } else if (t < 0.6875) {
    id = 0;
    t = (2 * t - 1) / (2 + t);
  } else if (t < 1.1875) {
    id = 1;
    t = (t - 1) / (t + 1);
  } else if (t < 2.4375) {
    id = 2;
    t = (t - 1.5) / (1 + 1.5 * t);
  } else {
    id = 3;
    t = -1 / t;
  }
  const z = t * t;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  let r: number;
  if (id < 0) {
    r = t - t * (s1 + s2);
  } else {
    r = ATAN_HI[id] - (t * (s1 + s2) - ATAN_LO[id] - t);
  }
  return negative ? -r : r;
}

/**
 * Angle of the point (x, y), result in [-pi, pi]. atan2(0, 0) is 0; the sign of zero is not
 * distinguished (atan2(-0, -1) is pi).
 */
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return y === 0 && x === 0 ? 0 : NaN;
}

/** Arcsine, result in [-pi/2, pi/2]; NaN outside [-1, 1]. */
export function asin(x: number): number {
  return atan(x / Math.sqrt((1 - x) * (1 + x)));
}

/** Arccosine, result in [0, pi]; NaN outside [-1, 1]. */
export function acos(x: number): number {
  return 2 * atan(Math.sqrt((1 - x) / (1 + x)));
}

// --- exp, log, pow -------------------------------------------------------------------------

// POW2[k + POW2_BIAS] === 2^k for k in [-1074, 1023]; every entry is exact.
const POW2_BIAS = 1074;
const POW2 = new Float64Array(POW2_BIAS + 1024);
POW2[POW2_BIAS] = 1;
for (let k = 1; k <= 1023; k++) POW2[POW2_BIAS + k] = POW2[POW2_BIAS + k - 1] * 2;
for (let k = 1; k <= 1074; k++) POW2[POW2_BIAS - k] = POW2[POW2_BIAS - k + 1] * 0.5;

/** y * 2^k for k in [-1075, 1024]. */
function scale2(y: number, k: number): number {
  if (k > 1023) return y * 2 * POW2[POW2_BIAS + k - 1];
  if (k < -1021) return y * POW2[POW2_BIAS + k + 54] * POW2[POW2_BIAS - 54];
  return y * POW2[POW2_BIAS + k];
}

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const EXP_MAX = 709.782712893383973096;
const EXP_MIN = -745.13321910194110842;

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** e^x. */
export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > EXP_MAX) return Infinity;
  if (x < EXP_MIN) return 0;
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  return scale2(y, k);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

const MIN_NORMAL = 2.2250738585072014e-308;
const TWO_54 = 18014398509481984;

// Exact bit access to split x into mantissa and exponent. Big-endian by DataView default.
const bits = new DataView(new ArrayBuffer(8));

/** Natural logarithm. log(0) is -Infinity; negative input gives NaN. */
export function log(x: number): number {
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < MIN_NORMAL) {
    x *= TWO_54;
    k = -54;
  }
  bits.setFloat64(0, x);
  const hi = bits.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  bits.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
  let m = bits.getFloat64(0); // [1, 2)
  if (m > SQRT2) {
    m *= 0.5;
    k++;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + (t2 + t1)) + k * LN2_LO) - f);
}

function powInt(x: number, n: number): number {
  let e = n < 0 ? -n : n;
  let base = x;
  let result = 1;
  while (e > 0) {
    if (e % 2 === 1) result *= base;
    base *= base;
    e = Math.floor(e / 2);
  }
  return n < 0 ? 1 / result : result;
}

/**
 * x^y. Integer exponents up to 1024 use exact repeated squaring (pow(2, 10) === 1024);
 * other exponents use exp(y * log(x)). Negative x with non-integer y gives NaN.
 */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return NaN;
  const integer = Number.isInteger(y);
  if (integer && Math.abs(y) <= 1024) return powInt(x, y);
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!integer) return NaN;
    const r = exp(y * log(-x));
    return y % 2 === 0 ? r : -r;
  }
  return exp(y * log(x));
}

/** Cube root, defined for negative x. exp(log(|x|) / 3) refined by one Newton step. */
export function cbrt(x: number): number {
  if (x === 0 || x !== x || x === Infinity || x === -Infinity) return x;
  const a = x < 0 ? -x : x;
  let y = exp(log(a) / 3);
  y -= (y * y * y - a) / (3 * y * y);
  return x < 0 ? -y : y;
}

/** Length of (x, y), without the overflow protection of Math.hypot. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
