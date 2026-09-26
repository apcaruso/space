// Builds the master palette (style/palette.json) from per-ramp parameters (style/ramps.json).
// Pure: the same parameters always give the same palette (colour maths from core/dmath).
//
// 1. Each ramp is generated in OKLCH: lightness along a curve, chroma peaking mid-ramp, and a
//    hue shift towards a cool hue in the shadows and a warm hue in the highlights.
// 2. 23+ ramps of 4-6 tones do not fit in 63 colours, so tones of different ramps that are
//    perceptually close are merged into shared colours, closest pair first, until the palette
//    fits. A merge is refused if it joins two tones of one ramp, breaks the lightness order of a
//    ramp, moves any tone further than `mergeDistance`, rotates the hue of a saturated tone by
//    more than `maxHueMove` or drains more than `maxChromaLoss` of its chroma, tints a grey
//    tone, or makes two ramps share more than
//    `maxShared` colours. The key tone of every ramp (the middle one, index floor(n / 2)) is
//    never shared, so each ramp keeps a colour of its own and neighbouring ramps stay apart.

import { pow } from '../core/dmath';
import {
  clipChroma,
  hexToRgb8,
  labDistance,
  oklabToOklch,
  oklabToRgb8,
  oklchToOklab,
  rgb8ToHex,
  rgb8ToOklab,
  type Lab,
} from '../toolkit/color';
import type { PaletteData } from '../toolkit/palette';

export interface RampParams {
  name: string;
  /** OKLCH hue of the mid tone, degrees. */
  hue: number;
  /** Peak OKLCH chroma (reached mid-ramp). */
  chroma: number;
  /** OKLab lightness of the darkest and lightest tone. */
  lightness: [number, number];
  /** Number of tones, 4-6. */
  tones: number;
  /** Exponent of the lightness curve: > 1 packs tones towards the dark end. Default 1. */
  curve?: number;
  /** Maximum hue rotation at the ends, degrees, towards coolHue (dark) and warmHue (light). */
  hueShift?: number;
  /** Chroma loss at the ends: chroma * (1 - falloff * (2t - 1)^2). Default 0.3. */
  chromaFalloff?: number;
  /** Per-ramp shadow and highlight hue targets, overriding the palette-wide ones. */
  coolHue?: number;
  warmHue?: number;
}

export interface PaletteParams {
  /** Opaque colours allowed; index 0 is reserved for transparency. */
  maxColors: number;
  minColors: number;
  /** Largest OKLab distance a tone may move when merged into a shared colour. */
  mergeDistance: number;
  /** Largest hue rotation, degrees, for tones with chroma >= 0.04; greys must stay below that chroma. */
  maxHueMove: number;
  /** Largest fraction of chroma a saturated tone may lose, 0..1. */
  maxChromaLoss: number;
  /** Most colours two ramps may share. */
  maxShared: number;
  /** Minimum OKLab lightness step between adjacent tones of a ramp. */
  minStep: number;
  coolHue: number;
  warmHue: number;
  ramps: RampParams[];
}

export interface BuildResult {
  data: PaletteData;
  report: string[];
}

interface Member {
  ramp: number;
  tone: number;
  origin: Lab;
  key: boolean;
}

interface ColorNode {
  lab: Lab;
  members: Member[];
}

/** Rotates hue `h` towards `target` by at most `deg`, along the shorter arc. */
function towards(h: number, target: number, deg: number): number {
  const diff = ((target - h + 540) % 360) - 180;
  const moved = Math.abs(diff) <= deg ? target : h + Math.sign(diff) * deg;
  return ((moved % 360) + 360) % 360;
}

/** The tones of one ramp, dark to light, clipped to the sRGB gamut. */
export function rampTones(ramp: RampParams, params: PaletteParams): Lab[] {
  const n = ramp.tones;
  const [l0, l1] = ramp.lightness;
  const curve = ramp.curve ?? 1;
  const shift = ramp.hueShift ?? 0;
  const falloff = ramp.chromaFalloff ?? 0.3;
  const out: Lab[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const L = l0 + (l1 - l0) * pow(t, curve);
    const s = 1 - 2 * t;
    const cool = ramp.coolHue ?? params.coolHue;
    const warm = ramp.warmHue ?? params.warmHue;
    const hue = s > 0 ? towards(ramp.hue, cool, shift * s) : towards(ramp.hue, warm, -shift * s);
    const u = 2 * t - 1;
    const C = ramp.chroma * (1 - falloff * u * u);
    out.push(clipChroma(oklchToOklab(L, C, hue)));
  }
  return out;
}

const SATURATED = 0.04;

/**
 * Does moving a tone from `from` to `to` keep its tint? Greys stay grey; saturated tones keep
 * their hue and most of their chroma.
 */
function keepsTint(from: Lab, to: Lab, params: PaletteParams): boolean {
  const [, c0, h0] = oklabToOklch(from);
  const [, c1, h1] = oklabToOklch(to);
  if (c0 < SATURATED) return c1 < SATURATED;
  if (c1 < c0 * (1 - params.maxChromaLoss)) return false;
  const d = Math.abs(h1 - h0) % 360;
  return (d > 180 ? 360 - d : d) <= params.maxHueMove;
}

function average(a: ColorNode, b: ColorNode): Lab {
  const wa = a.members.length;
  const wb = b.members.length;
  const w = wa + wb;
  return clipChroma([
    (a.lab[0] * wa + b.lab[0] * wb) / w,
    (a.lab[1] * wa + b.lab[1] * wb) / w,
    (a.lab[2] * wa + b.lab[2] * wb) / w,
  ]);
}

function validate(params: PaletteParams): void {
  const names = new Set<string>();
  for (const r of params.ramps) {
    if (names.has(r.name)) throw new Error(`duplicate ramp name ${r.name}`);
    names.add(r.name);
    if (!Number.isInteger(r.tones) || r.tones < 4 || r.tones > 6) throw new Error(`${r.name}: tones must be 4-6`);
    if (!(r.lightness[0] < r.lightness[1])) throw new Error(`${r.name}: lightness must increase`);
  }
  if (params.maxColors > 255) throw new Error('maxColors must be at most 255');
}

export function buildPalette(params: PaletteParams): BuildResult {
  validate(params);
  const report: string[] = [];
  const R = params.ramps.length;

  const nodes: ColorNode[] = [];
  const rampNodes: ColorNode[][] = params.ramps.map((ramp, r) =>
    rampTones(ramp, params).map((lab, tone) => {
      const key = tone === Math.floor(ramp.tones / 2);
      const node: ColorNode = { lab, members: [{ ramp: r, tone, origin: lab, key }] };
      nodes.push(node);
      return node;
    }),
  );
  const toneCount = nodes.length;
  const shared: number[][] = Array.from({ length: R }, () => new Array<number>(R).fill(0));

  const rampsOf = (node: ColorNode) => node.members.map((m) => m.ramp);

  // Lightness order of every ramp touched by the merge, with the merged colour in place.
  const keepsOrder = (a: ColorNode, b: ColorNode, lab: Lab): boolean => {
    for (const m of [...a.members, ...b.members]) {
      const seq = rampNodes[m.ramp];
      const L = (i: number) => (seq[i] === a || seq[i] === b ? lab[0] : seq[i].lab[0]);
      if (m.tone > 0 && L(m.tone) - L(m.tone - 1) < params.minStep) return false;
      if (m.tone < seq.length - 1 && L(m.tone + 1) - L(m.tone) < params.minStep) return false;
    }
    return true;
  };

  let maxMove = 0;
  while (nodes.length > params.maxColors) {
    let best: { i: number; j: number; d: number; lab: Lab } | undefined;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const d = labDistance(a.lab, b.lab);
        if (d > params.mergeDistance || (best !== undefined && d >= best.d)) continue;
        if (a.members.some((m) => m.key) || b.members.some((m) => m.key)) continue;
        const ra = rampsOf(a);
        const rb = rampsOf(b);
        if (ra.some((r) => rb.includes(r))) continue;
        if (ra.some((p) => rb.some((q) => shared[p][q] + 1 > params.maxShared))) continue;
        const lab = average(a, b);
        const members = [...a.members, ...b.members];
        if (members.some((m) => labDistance(m.origin, lab) > params.mergeDistance)) continue;
        if (members.some((m) => !keepsTint(m.origin, lab, params))) continue;
        if (!keepsOrder(a, b, lab)) continue;
        best = { i, j, d, lab };
      }
    }
    if (best === undefined) {
      throw new Error(
        `cannot fit the palette: ${nodes.length} colours left, max ${params.maxColors}. ` +
          'Raise mergeDistance or maxShared, use fewer tones, or bring similar ramps closer.',
      );
    }
    const a = nodes[best.i];
    const b = nodes[best.j];
    for (const p of rampsOf(a)) {
      for (const q of rampsOf(b)) {
        shared[p][q]++;
        shared[q][p]++;
      }
    }
    const merged: ColorNode = { lab: best.lab, members: [...a.members, ...b.members] };
    for (const m of merged.members) {
      rampNodes[m.ramp][m.tone] = merged;
      maxMove = Math.max(maxMove, labDistance(m.origin, merged.lab));
    }
    nodes.splice(best.j, 1);
    nodes.splice(best.i, 1, merged);
    const label = merged.members.map((m) => `${params.ramps[m.ramp].name}[${m.tone}]`).join(' + ');
    report.push(`merge d=${best.d.toFixed(4)}  ${label}`);
  }
  if (nodes.length < params.minColors) {
    throw new Error(`palette has ${nodes.length} colours, fewer than minColors ${params.minColors}`);
  }

  // Indices in ramp order, so the palette reads ramp by ramp.
  const colors: (string | null)[] = [null];
  const indexOf = new Map<ColorNode, number>();
  const seenHex = new Set<string>();
  const ramps = params.ramps.map((ramp, r) => ({
    name: ramp.name,
    tones: rampNodes[r].map((node) => {
      let index = indexOf.get(node);
      if (index === undefined) {
        const hex = rgb8ToHex(oklabToRgb8(node.lab));
        if (seenHex.has(hex)) throw new Error(`two palette colours quantise to ${hex}`);
        seenHex.add(hex);
        index = colors.length;
        colors.push(hex);
        indexOf.set(node, index);
      }
      return index;
    }),
  }));

  for (const ramp of ramps) {
    for (let t = 1; t < ramp.tones.length; t++) {
      const prev = rgb8ToOklab(hexOf(colors, ramp.tones[t - 1]))[0];
      const cur = rgb8ToOklab(hexOf(colors, ramp.tones[t]))[0];
      if (!(cur > prev)) throw new Error(`${ramp.name}: tone ${t} is not lighter than tone ${t - 1} after quantisation`);
    }
  }

  report.unshift(
    `${toneCount} tones in ${R} ramps -> ${colors.length - 1} colours (+ transparent), ` +
      `${toneCount - (colors.length - 1)} shared, largest tone move ${maxMove.toFixed(4)}`,
  );
  return { data: { colors, ramps }, report };
}

function hexOf(colors: readonly (string | null)[], index: number): readonly [number, number, number] {
  const hex = colors[index];
  if (hex === null) throw new Error('ramp uses the transparent index');
  return hexToRgb8(hex);
}

/** One colour row of eight and one ramp per line, so diffs stay readable. */
export function formatPalette(data: PaletteData): string {
  const colors: string[] = [];
  for (let i = 0; i < data.colors.length; i += 8) {
    colors.push(`    ${data.colors.slice(i, i + 8).map((c) => JSON.stringify(c)).join(', ')}`);
  }
  const ramps = data.ramps.map((r) => `    { "name": ${JSON.stringify(r.name)}, "tones": [${r.tones.join(', ')}] }`);
  return `{\n  "colors": [\n${colors.join(',\n')}\n  ],\n  "ramps": [\n${ramps.join(',\n')}\n  ]\n}\n`;
}
