// forge view: renders the explorer in Node with the same renderer as the app, to look at it
// without a browser. Sprites are generated synchronously, so every frame is complete.

import { performance } from 'node:perf_hooks';
import { IndexedBuffer } from '../../core/buffer';
import { AddressError, parseAddress, resolve } from '../../universe/address';
import { buildBand } from '../../view/catalogue';
import { Explorer } from '../../view/explorer';
import { LEVELS, type Level } from '../../view/places';
import { SyncSprites } from '../../view/sprites';
import type { TransitionMode } from '../../view/world';
import { UsageError, type ParsedArgs } from '../args';
import { chunk, composeGrid, outputPath, palette, positiveInt, savePng, writeOutput, type Command } from '../common';
import { encodeGif } from '../gif';

function zoomOption(values: ParsedArgs['values'], name: string): Level | number | undefined {
  const v = values[name];
  if (v === undefined) return undefined;
  const text = String(v);
  if ((LEVELS as readonly string[]).includes(text)) return text as Level;
  const n = Number(text);
  if (text.trim() === '' || !Number.isFinite(n)) throw new UsageError(`--${name} vuole un numero o un livello (${LEVELS.join(', ')}), ricevuto "${text}"`);
  return n;
}

export const view: Command = {
  name: 'view',
  usage: 'view <indirizzo> [--zoom z] [--zoom-to z2] [--tick n] [--step t] [--frames n] [--transition cut|dither] [--scale n] [--strip] [-o out/x.png|.gif]',
  summary: "una vista dell'esploratore resa in Node con lo stesso renderer dell'app; con --frames una GIF (zoom da --zoom a --zoom-to, tempo con --step)",
  options: {
    zoom: { kind: 'string', value: 'z', doc: `zoom: log2 dei pixel per settore, o un livello (${LEVELS.join(', ')}); default: il livello dell'indirizzo` },
    'zoom-to': { kind: 'string', value: 'z2', doc: 'zoom finale della GIF (interpolato in scala logaritmica)' },
    tick: { kind: 'int', value: 'n', doc: 'tempo in tick, default 0' },
    step: { kind: 'int', value: 't', doc: 'tick tra un fotogramma e il successivo della GIF, default 0' },
    frames: { kind: 'int', value: 'n', doc: 'fotogrammi della GIF (senza: una PNG)' },
    fps: { kind: 'int', value: 'n', doc: 'fotogrammi al secondo della GIF, default 24' },
    transition: { kind: 'string', value: 'cut|dither', doc: 'passaggio tra gradini di dimensione, default cut' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, default 2' },
    strip: { kind: 'flag', doc: 'con --frames: scrive anche una striscia PNG di alcuni fotogrammi' },
    'no-select': { kind: 'flag', doc: "non selezionare l'oggetto dell'indirizzo (niente scheda)" },
    hints: { kind: 'flag', doc: 'mostra la riga di aiuto in basso' },
    debug: { kind: 'flag', doc: "mostra l'overlay di debug (F3)" },
    out: { kind: 'string', value: 'out/file', short: 'o', doc: 'file di uscita, dentro out/ (.png o, con --frames, .gif)' },
  },
  run(args, io) {
    const text = args.positionals[0] ?? '0';
    let address;
    try {
      address = parseAddress(text);
      resolve(address);
    } catch (e) {
      if (e instanceof AddressError) throw new UsageError(`view: ${e.message}`);
      throw e;
    }
    const v = args.values;
    const transition = (v.transition ?? 'cut') as TransitionMode;
    if (transition !== 'cut' && transition !== 'dither') throw new UsageError(`view: --transition vuole cut o dither, ricevuto "${String(v.transition)}"`);
    const explorer = new Explorer({ galaxy: address.galaxy, loadBand: buildBand, transition });
    // In Node every frame is complete: all glow samples and systems at once.
    explorer.world.hazeBudget = Infinity;
    explorer.world.systemBudget = Infinity;
    const tick = typeof v.tick === 'number' ? v.tick : 0;
    explorer.tick = tick;
    const defaultLevel: Level = address.body !== undefined ? 'body' : address.system !== undefined ? 'system' : address.sector !== undefined ? 'region' : 'galaxy';
    const from = zoomOption(v, 'zoom') ?? defaultLevel;
    const place = explorer.place(address);
    if (address.system !== undefined && v['no-select'] !== true) explorer.selected = address;
    explorer.help = v.hints === true;
    explorer.debug = v.debug === true;
    const z0 = typeof from === 'number' ? from : place.zoom[from];
    const toOpt = zoomOption(v, 'zoom-to');
    const z1 = toOpt === undefined ? z0 : typeof toOpt === 'number' ? toOpt : place.zoom[toOpt];
    const frames = v.frames === undefined ? 1 : positiveInt(v, 'frames', 1);
    const step = typeof v.step === 'number' ? v.step : 0;
    const scale = positiveInt(v, 'scale', 2);
    const sprites = new SyncSprites(() => performance.now());

    const images: IndexedBuffer[] = [];
    const times: number[] = [];
    const first: number[] = [];
    let genBefore = 0;
    for (let i = 0; i < frames; i++) {
      const t = frames === 1 ? 0 : i / (frames - 1);
      explorer.tick = tick + i * step;
      explorer.anim = i;
      const z = z0 + (z1 - z0) * t;
      explorer.zoomDir = Math.sign(z1 - z0);
      explorer.goto(address, z);
      const t0 = performance.now();
      explorer.render(sprites);
      const total = performance.now() - t0;
      let gen = 0;
      for (const ms of sprites.stats.ms.values()) gen += ms;
      first.push(total - (gen - genBefore));
      genBefore = gen;
      images.push(new IndexedBuffer(explorer.fb.w, explorer.fb.h, explorer.fb.data.slice()));
      // The same frame again: what a frame costs once glow samples, systems and sprites are ready.
      const t1 = performance.now();
      explorer.render(sprites);
      times.push(performance.now() - t1);
    }

    const base = `view-${text.replace(/[^0-9a-z-]/gi, '_')}`;
    if (frames === 1) {
      const path = outputPath(v.out, `${base}.png`);
      savePng(path, images[0], scale);
      io.out(`${path}  zoom ${z0.toFixed(2)}  tick ${tick}  480x270 x${scale}`);
    } else {
      const path = outputPath(v.out, `${base}.gif`);
      if (!path.endsWith('.gif')) throw new UsageError(`view: con --frames l'uscita deve finire in .gif, ricevuto "${path}"`);
      writeOutput(path, encodeGif(images, palette, positiveInt(v, 'fps', 24), scale));
      io.out(`${path}  ${frames} fotogrammi, zoom ${z0.toFixed(2)}..${z1.toFixed(2)}, tick ${tick}..${tick + (frames - 1) * step}  x${scale}`);
      if (v.strip === true) {
        const pick = Array.from({ length: Math.min(8, frames) }, (_, k) => Math.round((k * (frames - 1)) / Math.max(1, Math.min(8, frames) - 1)));
        const cells = pick.map((k) => ({ buffer: images[k], label: `${k}` }));
        const stripPath = path.replace(/\.gif$/, '-strip.png');
        savePng(stripPath, composeGrid(chunk(cells, 4), { bg: true }), 1);
        io.out(`${stripPath}  fotogrammi ${pick.join(', ')}`);
      }
    }
    // Timing: composition per frame (without generation) and generation per generator.
    const report = (label: string, values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      io.out(`${label}: mediana ${med.toFixed(2)} ms, massimo ${sorted[sorted.length - 1].toFixed(2)} ms`);
    };
    report('tempo per frame a regime (composizione e interfaccia)', times);
    report('primo passaggio (senza sprite: bagliore, sistemi e catalogo nuovi, che nell\'app si distribuiscono su più frame)', first);
    for (const gen of [...sprites.stats.count.keys()].sort()) {
      const n = sprites.stats.count.get(gen) as number;
      const ms = sprites.stats.ms.get(gen) as number;
      io.out(`generazione ${gen}: ${n} sprite, ${(ms / n).toFixed(2)} ms in media, ${ms.toFixed(0)} ms in tutto`);
    }
    const c = sprites.cache.stats();
    io.out(`cache: ${c.entries} sprite, ${(c.bytes / 1024 / 1024).toFixed(1)} MB`);
    return 0;
  },
};
