// Commands that assemble several generator outputs: chunks (a seamless grid of background
// chunks) and scene (background plus objects, lit from a sun, like a view of the app).

import { existsSync, readFileSync } from 'node:fs';
import { IndexedBuffer } from '../../core/buffer';
import { registry } from '../../gen/index';
import { fieldAt, RecipeError } from '../../gen/schema';
import { direction } from '../../toolkit/light';
import { UsageError } from '../args';
import { cos, PI, sin } from '../../core/dmath';
import { BG, GEN_OPTIONS, generatorName, genOptions, outputPath, positiveInt, readRecipe, savePng, type Command } from '../common';

function withChunk(input: unknown, x: number, y: number): Record<string, unknown> {
  const base = typeof input === 'object' && input !== null ? (JSON.parse(JSON.stringify(input)) as Record<string, unknown>) : {};
  const chunk = typeof base.chunk === 'object' && base.chunk !== null ? (base.chunk as Record<string, unknown>) : {};
  return { ...base, chunk: { ...chunk, x, y } };
}

export const chunks: Command = {
  name: 'chunks',
  usage: 'chunks <gen> [--x 0..2] [--y 0..2] [--recipe f.json] [--seed n] [--size n] [--frame n] [--scale n] [-o out/x.png]',
  summary: 'griglia di chunk accostati senza spazi (generatori con chunk.x e chunk.y), per controllare le cuciture',
  options: {
    ...GEN_OPTIONS,
    seed: { kind: 'int', value: 'n', doc: 'seed, default 0' },
    x: { kind: 'seeds', value: '0..2', doc: 'colonne di chunk (default 0..2)' },
    y: { kind: 'seeds', value: '0..2', doc: 'righe di chunk (default 0..2)' },
  },
  run(args, io) {
    const name = generatorName(args, 'chunks');
    const v = args.values;
    const def = registry.get(name);
    try {
      fieldAt(def.recipe, 'chunk.x');
      fieldAt(def.recipe, 'chunk.y');
    } catch (e) {
      if (e instanceof RecipeError) throw new UsageError(`chunks: il generatore ${name} non ha chunk.x e chunk.y nella ricetta`);
      throw e;
    }
    const xs = (v.x as readonly number[] | undefined) ?? [0, 1, 2];
    const ys = (v.y as readonly number[] | undefined) ?? [0, 1, 2];
    const base = readRecipe(v.recipe);
    const opts = genOptions(v, name);
    const seed = typeof v.seed === 'number' ? v.seed : 0;
    const tiles = ys.map((cy) => xs.map((cx) => registry.run(name, withChunk(base, cx, cy), seed, opts).buffer));
    const size = tiles[0][0].w;
    const image = new IndexedBuffer(size * xs.length, size * ys.length);
    if (v.bg === true) image.fill(BG);
    tiles.forEach((row, j) => row.forEach((tile, i) => image.blit(tile, i * size, j * size)));
    const scale = positiveInt(v, 'scale', 1);
    const path = outputPath(v.out, `chunks-${name}.png`);
    savePng(path, image, scale);
    io.out(`${path}  ${def.name}@${def.version} seed ${seed}  chunk x ${xs.join(',')} y ${ys.join(',')}  ${image.w}x${image.h} x${scale}`);
    return 0;
  },
};

interface SceneObject {
  gen: string;
  seed: number;
  x: number;
  y: number;
  size?: number;
  frame?: number;
  recipe?: unknown;
}

interface Scene {
  width: number;
  height: number;
  background?: { seed: number; recipe?: unknown; offset?: [number, number]; size?: number };
  sun?: { x: number; y: number; elevation?: number };
  objects: SceneObject[];
}

function readScene(path: string): Scene {
  if (!existsSync(path)) throw new UsageError(`scene: file non trovato: ${path}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new UsageError(`scene: ${path} non è JSON valido: ${(e as Error).message}`);
  }
  const s = data as Partial<Scene>;
  const issues: string[] = [];
  const isInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n);
  if (!isInt(s.width) || !isInt(s.height) || (s.width as number) < 1 || (s.height as number) < 1) issues.push('width e height devono essere interi positivi');
  if (!Array.isArray(s.objects)) issues.push('objects deve essere un array');
  (s.objects ?? []).forEach((o, i) => {
    if (typeof o?.gen !== 'string') issues.push(`objects[${i}].gen: nome del generatore mancante`);
    for (const k of ['seed', 'x', 'y'] as const) if (!isInt(o?.[k])) issues.push(`objects[${i}].${k}: atteso un intero`);
  });
  if (s.sun !== undefined && (!isInt(s.sun.x) || !isInt(s.sun.y))) issues.push('sun: attesi x e y interi');
  if (issues.length > 0) throw new UsageError(`scene: file non valido:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  return s as Scene;
}

export const scene: Command = {
  name: 'scene',
  usage: 'scene <scena.json> [--frame n] [--scale n] [-o out/x.png]',
  summary: "compone sfondo e oggetti da un file JSON, con la luce di ogni oggetto che viene dal sole della scena",
  options: {
    frame: { kind: 'int', value: 'n', doc: 'frame per tutti gli oggetti, default 0' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, default 2' },
    out: { kind: 'string', value: 'out/file.png', short: 'o', doc: 'file di uscita, dentro out/' },
  },
  run(args, io) {
    const file = args.positionals[0];
    if (file === undefined) throw new UsageError('scene: manca il file della scena');
    const s = readScene(file);
    const frame = typeof args.values.frame === 'number' ? args.values.frame : 0;
    const image = new IndexedBuffer(s.width, s.height).fill(BG);

    if (s.background !== undefined) {
      const b = s.background;
      const size = b.size ?? 256;
      const [ox, oy] = b.offset ?? [0, 0];
      for (let cy = Math.floor(oy / size); cy * size < oy + s.height; cy++) {
        for (let cx = Math.floor(ox / size); cx * size < ox + s.width; cx++) {
          const tile = registry.run('background', withChunk(b.recipe ?? {}, cx, cy), b.seed, { size, frame }).buffer;
          image.blit(tile, cx * size - ox, cy * size - oy);
        }
      }
    }

    for (const o of s.objects) {
      const sun = s.sun;
      let lightDir;
      if (sun !== undefined && (sun.x !== o.x || sun.y !== o.y)) {
        // Light comes from the sun: its direction in the screen plane, raised by the elevation.
        const dx = sun.x - o.x;
        const dy = sun.y - o.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        // dmath, so the scene renders the same bytes on every machine.
        const e = ((sun.elevation ?? 20) * PI) / 180;
        lightDir = direction((dx / len) * cos(e), (dy / len) * cos(e), sin(e));
      }
      const r = registry.run(o.gen, o.recipe ?? {}, o.seed, { ...(o.size === undefined ? {} : { size: o.size }), frame: o.frame ?? frame, ...(lightDir ? { lightDir } : {}) });
      const centre = Array.isArray(r.descriptor.centre) ? (r.descriptor.centre as number[]) : [r.buffer.w / 2, r.buffer.h / 2];
      image.blit(r.buffer, Math.round(o.x - centre[0]), Math.round(o.y - centre[1]));
    }

    const scale = positiveInt(args.values, 'scale', 2);
    const path = outputPath(args.values.out, 'scene.png');
    savePng(path, image, scale);
    io.out(`${path}  ${s.objects.length} oggetti su ${s.width}x${s.height} x${scale}`);
    return 0;
  },
};
