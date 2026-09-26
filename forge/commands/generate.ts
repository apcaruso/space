// Commands that draw generator output: render, sheet, params, anim.

import { registry } from '../../gen/index';
import type { RunResult } from '../../gen/registry';
import { fieldAt, parseFieldText, withValue } from '../../gen/schema';
import { UsageError } from '../args';
import {
  chunk,
  composeGrid,
  GEN_OPTIONS,
  genOptions,
  generatorName,
  outputPath,
  palette,
  positiveInt,
  readRecipe,
  savePng,
  withBackground,
  writeOutput,
  type Cell,
  type Command,
  type Io,
} from '../common';
import { encodeGif } from '../gif';

/** Seed label: "12", "12r2" after two retries, "12!" when no attempt passed the validators. */
function seedLabel(r: RunResult): string {
  return `${r.seed}${r.attempt > 0 ? `r${r.attempt}` : ''}${r.accepted ? '' : '!'}`;
}

function reportRetries(results: readonly RunResult[], io: Io): void {
  const retried = results.filter((r) => r.attempt > 0);
  const failed = results.filter((r) => !r.accepted);
  if (retried.length > 0) io.out(`  ritentati: ${retried.map((r) => `${r.seed} (tentativo ${r.attempt})`).join(', ')}`);
  for (const r of failed) io.err(`  seed ${r.seed}: nessun tentativo ha passato i validatori (${r.rejections[0].reasons.map((x) => x.reason).join('; ')})`);
}

export const render: Command = {
  name: 'render',
  usage: 'render <gen> [--recipe f.json] [--seed n] [--size n] [--frame n] [--light deg] [--scale n] [--grid] [--bg] [-o out/x.png]',
  summary: 'un oggetto in PNG; stampa il suo descrittore',
  options: {
    ...GEN_OPTIONS,
    seed: { kind: 'int', value: 'n', doc: 'seed, default 0' },
    grid: { kind: 'flag', doc: 'disegna la griglia dei pixel (da scala 3 in su)' },
  },
  run(args, io) {
    const name = generatorName(args, 'render');
    const v = args.values;
    const scale = positiveInt(v, 'scale', 4);
    const r = registry.run(name, readRecipe(v.recipe), typeof v.seed === 'number' ? v.seed : 0, genOptions(v, name));
    const path = outputPath(v.out, `render-${name}-${r.seed}.png`);
    savePng(path, withBackground(r.buffer, v.bg === true), scale, v.grid === true);
    io.out(`${path}  ${r.id} seed ${seedLabel(r)}  ${r.buffer.w}x${r.buffer.h} x${scale}`);
    io.out(`descrittore ${JSON.stringify(r.descriptor)}`);
    reportRetries([r], io);
    return 0;
  },
};

export const sheet: Command = {
  name: 'sheet',
  usage: 'sheet <gen> [--recipe f.json] [--count 64] [--from n] [--cols 8] [--scale n] [--no-labels] [--bg] [-o out/x.png]',
  summary: 'griglia di varianti (seed consecutivi), con il seed scritto sotto ogni cella',
  options: {
    ...GEN_OPTIONS,
    count: { kind: 'int', value: 'n', doc: 'numero di seed, default 64' },
    from: { kind: 'int', value: 'n', doc: 'primo seed, default 0' },
    cols: { kind: 'int', value: 'n', doc: 'colonne, default 8' },
    labels: { kind: 'flag', doc: 'etichette dei seed sotto le celle (il default)' },
    'no-labels': { kind: 'flag', doc: 'senza etichette' },
  },
  run(args, io) {
    const name = generatorName(args, 'sheet');
    const v = args.values;
    const count = positiveInt(v, 'count', 64);
    const cols = positiveInt(v, 'cols', 8);
    const scale = positiveInt(v, 'scale', 2);
    const from = typeof v.from === 'number' ? v.from : 0;
    const labels = v['no-labels'] !== true;
    const recipe = readRecipe(v.recipe);
    const opts = genOptions(v, name);
    const results = Array.from({ length: count }, (_, i) => registry.run(name, recipe, from + i, opts));
    const cells: Cell[] = results.map((r) => ({ buffer: r.buffer, label: labels ? seedLabel(r) : undefined }));
    const image = composeGrid(chunk(cells, cols), { bg: v.bg === true });
    const path = outputPath(v.out, `sheet-${name}.png`);
    savePng(path, image, scale);
    io.out(`${path}  ${results[0].id} seed ${from}..${from + count - 1}  ${image.w}x${image.h} x${scale}`);
    reportRetries(results, io);
    return 0;
  },
};

export const params: Command = {
  name: 'params',
  usage: 'params <gen> --param a.b --values 1,2,3,4 [--seeds 0..7] [--recipe f.json] [--scale n] [--bg] [-o out/x.png]',
  summary: 'un parametro della ricetta nelle colonne e i seed nelle righe, per tarare',
  options: {
    ...GEN_OPTIONS,
    param: { kind: 'string', value: 'a.b', doc: 'percorso puntato del campo della ricetta da far variare' },
    values: { kind: 'list', value: 'v1,v2,...', doc: 'valori del campo, uno per colonna' },
    seeds: { kind: 'seeds', value: '0..7', doc: 'seed, uno per riga: "0..7" oppure "1,5,9" (default 0..7)' },
  },
  run(args, io) {
    const name = generatorName(args, 'params');
    const v = args.values;
    if (typeof v.param !== 'string') throw new UsageError('params: serve --param, per esempio --param noise.scale');
    if (!Array.isArray(v.values) || v.values.length === 0) throw new UsageError('params: serve --values, per esempio --values 1,2,4');
    const path = v.param;
    const texts = v.values as readonly string[];
    const seeds = (v.seeds as readonly number[] | undefined) ?? [0, 1, 2, 3, 4, 5, 6, 7];
    const scale = positiveInt(v, 'scale', 2);
    const def = registry.get(name);
    const field = fieldAt(def.recipe, path);
    const base = readRecipe(v.recipe);
    // Validate every column first, so a bad value fails before anything is drawn.
    const recipes = texts.map((text) => withValue(base, path, parseFieldText(field, text)));
    for (const recipe of recipes) registry.recipe(name, recipe);
    const opts = genOptions(v, name);
    const rows = seeds.map((seed) => recipes.map((recipe) => ({ buffer: registry.run(name, recipe, seed, opts).buffer })));
    const image = composeGrid(rows, {
      bg: v.bg === true,
      title: `${def.name}@${def.version} ${path}`,
      colLabels: texts,
      rowLabels: seeds.map(String),
    });
    const file = outputPath(v.out, `params-${name}-${path.replaceAll('.', '-')}.png`);
    savePng(file, image, scale);
    io.out(`${file}  ${path} = ${texts.join(', ')}  seed ${seeds.join(', ')}  ${image.w}x${image.h} x${scale}`);
    return 0;
  },
};

export const anim: Command = {
  name: 'anim',
  usage: 'anim <gen> [--frames n] [--fps n] [--frame start] [--seed n] [--recipe f.json] [--scale n] [--strip] [--cols 12] [--bg] [-o out/x.gif]',
  summary: 'GIF in loop di frame consecutivi; con --strip anche i frame affiancati in un PNG',
  options: {
    ...GEN_OPTIONS,
    seed: { kind: 'int', value: 'n', doc: 'seed, default 0' },
    frames: { kind: 'int', value: 'n', doc: 'numero di frame (default: un giro del generatore)' },
    fps: { kind: 'int', value: 'n', doc: 'frame al secondo, default 24 (la GIF arrotonda il ritardo ai centesimi di secondo)' },
    strip: { kind: 'flag', doc: 'scrive anche <out>-strip.png con ogni frame etichettato' },
    cols: { kind: 'int', value: 'n', doc: 'frame per riga nella striscia, default 12' },
  },
  run(args, io) {
    const name = generatorName(args, 'anim');
    const v = args.values;
    const def = registry.get(name);
    const count = positiveInt(v, 'frames', def.loop);
    const fps = positiveInt(v, 'fps', 24);
    const scale = positiveInt(v, 'scale', 3);
    const start = typeof v.frame === 'number' ? v.frame : 0;
    const base = genOptions(v, name);
    const partials = Array.from({ length: count }, (_, i) => ({ ...base, frame: start + i }));
    const results = registry.runMany(name, readRecipe(v.recipe), typeof v.seed === 'number' ? v.seed : 0, partials);
    const frames = results.map((r) => withBackground(r.buffer, v.bg === true));
    const path = outputPath(v.out, `anim-${name}.gif`);
    if (!path.endsWith('.gif')) throw new UsageError(`anim: l'uscita deve finire in .gif, ricevuto "${path}"`);
    writeOutput(path, encodeGif(frames, palette, fps, scale));
    io.out(`${path}  ${results[0].id} seed ${seedLabel(results[0])}  frame ${start}..${start + count - 1} a ${fps} fps  x${scale}`);
    if (v.strip === true) {
      const stripPath = path.replace(/\.gif$/, '-strip.png');
      const cells = results.map((r, i) => ({ buffer: frames[i], label: String(r.opts.frame) }));
      const image = composeGrid(chunk(cells, positiveInt(v, 'cols', 12)), { bg: v.bg === true });
      savePng(stripPath, image, 2);
      io.out(`${stripPath}  ${count} frame  ${image.w}x${image.h} x2`);
    }
    reportRetries([results[0]], io);
    return 0;
  },
};

export const sizes: Command = {
  name: 'sizes',
  usage: 'sizes <gen> [--sizes 16,32,64,128,256] [--seed n] [--recipe f.json] [--frame n] [--light gradi] [--scale n] [--bg] [-o out/x.png]',
  summary: 'lo stesso oggetto a più dimensioni affiancate, per verificare la coerenza tra gradini di zoom',
  options: {
    ...GEN_OPTIONS,
    seed: { kind: 'int', value: 'n', doc: 'seed, default 0' },
    sizes: { kind: 'seeds', value: '16,32,64', doc: 'dimensioni da affiancare (default: 16,32,64,128,256 entro i limiti del generatore)' },
  },
  run(args, io) {
    const name = generatorName(args, 'sizes');
    const v = args.values;
    const def = registry.get(name);
    const wanted = (v.sizes as readonly number[] | undefined) ?? [16, 32, 64, 128, 256].filter((s) => s >= def.sizes.min && s <= def.sizes.max);
    const scale = positiveInt(v, 'scale', 2);
    const base = genOptions(v, name);
    const results = registry.runMany(name, readRecipe(v.recipe), typeof v.seed === 'number' ? v.seed : 0, wanted.map((size) => ({ ...base, size })));
    const image = composeGrid([results.map((r) => ({ buffer: r.buffer, label: `${r.opts.size} px` }))], { bg: v.bg === true });
    const path = outputPath(v.out, `sizes-${name}.png`);
    savePng(path, image, scale);
    io.out(`${path}  ${results[0].id} seed ${seedLabel(results[0])}  lati ${wanted.join(', ')}  ${image.w}x${image.h} x${scale}`);
    return 0;
  },
};
