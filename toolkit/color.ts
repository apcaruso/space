// Colour spaces for palette work: sRGB, linear sRGB, OKLab and OKLCH (Björn Ottosson's
// perceptual space). Built on core/dmath, so conversions are identical everywhere.

import { atan2, cbrt, cos, PI, pow, sin } from '../core/dmath';

export type Rgb8 = readonly [r: number, g: number, b: number];
export type Lab = readonly [L: number, a: number, b: number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055;
}

export function linearToOklab(r: number, g: number, b: number): Lab {
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Linear sRGB of an OKLab colour; components may fall outside [0, 1] (out of gamut). */
export function oklabToLinear(L: number, a: number, b: number): [r: number, g: number, b: number] {
  const l = L + 0.3963377774 * a + 0.2158037573 * b;
  const m = L - 0.1055613458 * a - 0.0638541728 * b;
  const s = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l * l * l;
  const m3 = m * m * m;
  const s3 = s * s * s;
  return [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
}

export function rgb8ToOklab(rgb: Rgb8): Lab {
  return linearToOklab(srgbToLinear(rgb[0] / 255), srgbToLinear(rgb[1] / 255), srgbToLinear(rgb[2] / 255));
}

/** OKLCH (hue in degrees) to OKLab. */
export function oklchToOklab(L: number, C: number, hueDeg: number): Lab {
  const h = (hueDeg * PI) / 180;
  return [L, C * cos(h), C * sin(h)];
}

/** OKLab to OKLCH, hue in degrees in [0, 360). */
export function oklabToOklch(lab: Lab): [L: number, C: number, hueDeg: number] {
  const C = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
  let h = (atan2(lab[2], lab[1]) * 180) / PI;
  if (h < 0) h += 360;
  return [lab[0], C, h];
}

const GAMUT_EPS = 1e-9;

export function inGamut(lab: Lab): boolean {
  const [r, g, b] = oklabToLinear(lab[0], lab[1], lab[2]);
  return r >= -GAMUT_EPS && r <= 1 + GAMUT_EPS && g >= -GAMUT_EPS && g <= 1 + GAMUT_EPS && b >= -GAMUT_EPS && b <= 1 + GAMUT_EPS;
}

/** Brings an OKLab colour into the sRGB gamut by lowering its chroma, keeping L and hue. */
export function clipChroma(lab: Lab): Lab {
  const L = Math.min(1, Math.max(0, lab[0]));
  const clamped: Lab = [L, lab[1], lab[2]];
  if (inGamut(clamped)) return clamped;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut([L, lab[1] * mid, lab[2] * mid])) lo = mid;
    else hi = mid;
  }
  return [L, lab[1] * lo, lab[2] * lo];
}

/** 8-bit sRGB of an in-gamut OKLab colour. */
export function oklabToRgb8(lab: Lab): Rgb8 {
  const [r, g, b] = oklabToLinear(lab[0], lab[1], lab[2]);
  const to8 = (c: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.max(0, c)))) * 255);
  return [to8(r), to8(g), to8(b)];
}

export function rgb8ToHex(rgb: Rgb8): string {
  return `#${((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1)}`;
}

export function hexToRgb8(hex: string): Rgb8 {
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new RangeError(`not a #rrggbb colour: ${hex}`);
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

export function labDistance(p: Lab, q: Lab): number {
  const dL = p[0] - q[0];
  const da = p[1] - q[1];
  const db = p[2] - q[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}
