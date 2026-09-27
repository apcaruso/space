// Commands on the universe: maps of the galaxy, views of systems, and a census of many systems.

import { IndexedBuffer } from '../../core/buffer';
import { galaxyMap, regionMap } from '../../gen/maps/galaxy';
import { systemView } from '../../gen/maps/system';
import { AddressError, formatAddress, parseAddress, resolve, type Resolved } from '../../universe/address';
import { censusOf, EXPECTED, sampleSystems } from '../../universe/census';
import { Galaxy } from '../../universe/galaxy';
import { generateSystem, type StarSystem } from '../../universe/system';
import { UsageError, type ParsedArgs } from '../args';
import { encodeGif } from '../gif';
import { chunk, composeGrid, outputPath, palette, positiveInt, savePng, writeOutput, type Command, type Io } from '../common';

function galaxySeed(values: ParsedArgs['values']): number {
  const g = values.galaxy;
  if (g === undefined) return 0;
  if (typeof g !== 'number' || g < 0 || g > 0xffffffff) throw new UsageError(`--galaxy vuole un intero tra 0 e ${0xffffffff}, ricevuto ${String(g)}`);
  return g;
}

function sectorOption(values: ParsedArgs['values'], name: string): [number, number] | undefined {
  const v = values[name];
  if (v === undefined) return undefined;
  const parts = v as readonly string[];
  if (parts.length !== 2 || !parts.every((p) => /^-?\d+$/.test(p))) throw new UsageError(`--${name} vuole due interi "sx,sy", ricevuto "${parts.join(',')}"`);
  return [Number(parts[0]), Number(parts[1])];
}

export const galaxy: Command = {
  name: 'galaxy',
  usage: 'galaxy [--galaxy n] [--center sx,sy --radius n --cell px] [--scale n] [-o out/x.png]',
  summary: 'mappa della galassia intera (un pixel per settore) o di una regione ingrandita, stelle colorate per classe',
  options: {
    galaxy: { kind: 'int', value: 'n', doc: 'seed della galassia, default 0' },
    center: { kind: 'list', value: 'sx,sy', doc: 'settore al centro di una regione ingrandita (senza: la galassia intera)' },
    radius: { kind: 'int', value: 'n', doc: 'settori dal centro al bordo della regione, default 12' },
    cell: { kind: 'int', value: 'px', doc: 'pixel per settore nella regione, default 12' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, default 2' },
    out: { kind: 'string', value: 'out/file.png', short: 'o', doc: 'file di uscita, dentro out/' },
  },
  run(args, io) {
    const v = args.values;
    const g = new Galaxy(galaxySeed(v));
    const center = sectorOption(v, 'center');
    const scale = positiveInt(v, 'scale', 2);
    const s = g.shape;
    const shape = `raggio ${s.radius.toFixed(0)} settori, ${s.arms} bracci, ${s.bar > 0 ? 'con barra' : 'senza barra'}`;
    if (center === undefined) {
      const map = galaxyMap(g);
      const path = outputPath(v.out, `galaxy-${g.seed}.png`);
      savePng(path, map.buffer, scale);
      io.out(`${path}  galassia ${g.seed}: ${shape}; ${map.systems} sistemi  ${map.buffer.w}x${map.buffer.h} x${scale}`);
      return 0;
    }
    const radius = positiveInt(v, 'radius', 12);
    const cell = positiveInt(v, 'cell', 12);
    if ((2 * radius + 1) * cell > 4096) throw new UsageError('galaxy: regione troppo grande (al massimo 4096 pixel di lato prima di --scale)');
    const map = regionMap(g, { cx: center[0], cy: center[1], radius, cell });
    const path = outputPath(v.out, `galaxy-${g.seed}-${center[0]}_${center[1]}.png`);
    savePng(path, map.buffer, scale);
    io.out(`${path}  galassia ${g.seed}, settori ${map.origin[0]}..${map.origin[0] + 2 * radius}, ${map.origin[1]}..${map.origin[1] + 2 * radius}: ${map.systems} sistemi  ${map.buffer.w}x${map.buffer.h} x${scale}`);
    return 0;
  },
};

const ZONE_NAMES: Readonly<Record<string, string>> = { hot: 'calda', habitable: 'abitabile', cold: 'fredda', frost: 'oltre la neve' };

function fmt(x: number): string {
  return x >= 100 ? x.toFixed(0) : x >= 1 ? x.toFixed(2) : x.toPrecision(2);
}

/** Readable description of a system, one body per line. */
function describeSystem(s: StarSystem, io: Io): void {
  const address = formatAddress({ galaxy: s.galaxy, sector: { sx: s.sx, sy: s.sy }, system: s.index });
  io.out(`${s.name} (${s.code})  indirizzo ${address}  settore ${s.sx},${s.sy}  età ${s.age}`);
  io.out(`  zona abitabile ${fmt(s.habitable[0])}-${fmt(s.habitable[1])} UA, linea della neve ${fmt(s.snowLine)} UA`);
  for (const st of s.stars) {
    const orbit = st.orbit === null ? '' : `  orbita ${fmt(st.orbit.a)} UA, periodo ${st.orbit.period} tick`;
    io.out(`  s${st.index} ${st.name}: ${st.label} (${st.class}), ${fmt(st.mass)} masse solari, ${fmt(st.luminosity)} luminosità solari, ${st.temperature} K${orbit}`);
  }
  for (const p of s.planets) {
    const proper = p.properName === null ? '' : ` "${p.properName}"`;
    const extra = [p.rings ? 'anelli' : '', p.moons.length > 0 ? `${p.moons.length} lun${p.moons.length === 1 ? 'a' : 'e'}` : ''].filter((x) => x !== '').join(', ');
    io.out(`  p${p.index} ${p.name}${proper}: ${p.archetype}, zona ${ZONE_NAMES[p.zone]}, ${fmt(p.radius)} raggi terrestri, a ${fmt(p.orbit.a)} UA, e ${p.orbit.e}, anno ${p.orbit.period} tick, giorno ${p.rotation.period} tick${extra === '' ? '' : `; ${extra}`}`);
  }
  for (const b of s.belts) io.out(`  a${b.index} ${b.name}: ${b.material}, ${fmt(b.inner)}-${fmt(b.outer)} UA`);
  for (const c of s.comets) io.out(`  c${c.index} ${c.name}: perielio ${fmt(c.orbit.a * (1 - c.orbit.e))} UA, e ${c.orbit.e}, periodo ${c.orbit.period} tick`);
}

function describeBody(r: Resolved, io: Io): void {
  switch (r.kind) {
    case 'moon':
      io.out(`luna ${r.moon.name}: ${r.moon.archetype}, ${fmt(r.moon.radius)} raggi terrestri, orbita ${fmt(r.moon.orbit.a)} raggi del pianeta, periodo ${r.moon.orbit.period} tick`);
      return;
    case 'planet':
      io.out(`pianeta ${r.planet.name}: ricetta ${JSON.stringify(r.planet.recipe)}, seed dell'aspetto ${r.planet.look}`);
      return;
    case 'star':
      io.out(`stella ${r.star.name}: ricetta ${JSON.stringify(r.star.recipe)}, seed ${r.star.seed}`);
      return;
    case 'belt':
      io.out(`fascia ${r.belt.name}: ${r.belt.material}, ${fmt(r.belt.inner)}-${fmt(r.belt.outer)} UA`);
      return;
    case 'comet':
      io.out(`cometa ${r.comet.name}: a ${fmt(r.comet.orbit.a)} UA, e ${r.comet.orbit.e}`);
      return;
    default:
  }
}

function intOption(values: ParsedArgs['values'], name: string, fallback: number): number {
  const v = values[name];
  return typeof v === 'number' ? v : fallback;
}

export const system: Command = {
  name: 'system',
  usage: 'system <indirizzo> [--tick n] [--frames n --step t --fps n] [--size px] [--scale n] [-o out/x.png|.gif]',
  summary: 'vista di un sistema (orbite, stelle, pianeti, lune, fasce, comete) al tick dato; con --frames una GIF',
  options: {
    tick: { kind: 'int', value: 'n', doc: 'tempo in tick (1 tick = 1 ora), default 0' },
    frames: { kind: 'int', value: 'n', doc: 'fotogrammi della GIF (senza: una PNG)' },
    step: { kind: 'int', value: 't', doc: 'tick tra un fotogramma e il successivo (default: un giro del pianeta più interno)' },
    fps: { kind: 'int', value: 'n', doc: 'fotogrammi al secondo della GIF, default 12' },
    size: { kind: 'int', value: 'px', doc: 'lato della vista, 64..512, default 384' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, default 2' },
    out: { kind: 'string', value: 'out/file', short: 'o', doc: 'file di uscita, dentro out/ (.png o, con --frames, .gif)' },
  },
  run(args, io) {
    const text = args.positionals[0];
    if (text === undefined) throw new UsageError('system: manca l\'indirizzo (per esempio 0.3.-5.2; vedi forge systems)');
    let resolved: Resolved;
    try {
      resolved = resolve(parseAddress(text));
    } catch (e) {
      if (e instanceof AddressError) throw new UsageError(`system: ${e.message}`);
      throw e;
    }
    if (resolved.kind === 'galaxy' || resolved.kind === 'sector') throw new UsageError('system: l\'indirizzo deve arrivare almeno al sistema (galassia.sx.sy.sistema)');
    const s = resolved.system;
    const v = args.values;
    const size = positiveInt(v, 'size', 384);
    if (size < 64 || size > 512) throw new UsageError(`system: --size deve stare tra 64 e 512, ricevuto ${size}`);
    const scale = positiveInt(v, 'scale', 2);
    const tick = intOption(v, 'tick', 0);
    const sector = resolved.galaxy.sector(s.sx, s.sy);
    describeSystem(s, io);
    describeBody(resolved, io);
    const base = `system-${text.replace(/[^0-9a-z-]/gi, '_')}`;
    if (v.frames === undefined) {
      const path = outputPath(v.out, `${base}.png`);
      savePng(path, systemView(s, sector, { size, tick, labels: true }), scale);
      io.out(`${path}  tick ${tick}  ${size}x${size} x${scale}`);
      return 0;
    }
    const frames = positiveInt(v, 'frames', 48);
    const innermost = s.planets.length > 0 ? s.planets[0].orbit.period : 8766;
    const step = positiveInt(v, 'step', Math.max(1, Math.round(innermost / frames)));
    const fps = positiveInt(v, 'fps', 12);
    const images: IndexedBuffer[] = [];
    for (let i = 0; i < frames; i++) images.push(systemView(s, sector, { size, tick: tick + i * step, frame: i, labels: true }));
    const path = outputPath(v.out, `${base}.gif`);
    if (!path.endsWith('.gif')) throw new UsageError(`system: con --frames l'uscita deve finire in .gif, ricevuto "${path}"`);
    writeOutput(path, encodeGif(images, palette, fps, scale));
    io.out(`${path}  ${frames} fotogrammi, tick ${tick}..${tick + (frames - 1) * step} (passo ${step})  ${size}x${size} x${scale}`);
    return 0;
  },
};

export const systems: Command = {
  name: 'systems',
  usage: 'systems [--galaxy n] [--count 16] [--seed n] [--tick n] [--size px] [--scale n] [-o out/x.png]',
  summary: 'foglio di viste di sistemi scelti a caso tra quelli della galassia, con i loro indirizzi',
  options: {
    galaxy: { kind: 'int', value: 'n', doc: 'seed della galassia, default 0' },
    count: { kind: 'int', value: 'n', doc: 'quanti sistemi, default 16' },
    seed: { kind: 'int', value: 'n', doc: 'seed della scelta, default 0' },
    tick: { kind: 'int', value: 'n', doc: 'tempo in tick, default 0' },
    size: { kind: 'int', value: 'px', doc: 'lato di ogni vista, 64..512, default 256' },
    scale: { kind: 'int', value: 'n', doc: 'ingrandimento intero, default 1' },
    out: { kind: 'string', value: 'out/file.png', short: 'o', doc: 'file di uscita, dentro out/' },
  },
  run(args, io) {
    const v = args.values;
    const g = new Galaxy(galaxySeed(v));
    const count = positiveInt(v, 'count', 16);
    if (count > 64) throw new UsageError('systems: al massimo 64 sistemi per foglio');
    const size = positiveInt(v, 'size', 256);
    if (size < 64 || size > 512) throw new UsageError(`systems: --size deve stare tra 64 e 512, ricevuto ${size}`);
    const tick = intOption(v, 'tick', 0);
    const refs = sampleSystems(g, count, intOption(v, 'seed', 0));
    const cells = refs.map((r) => {
      const s = generateSystem(g, r.sx, r.sy, r.index);
      const address = formatAddress({ galaxy: g.seed, sector: { sx: r.sx, sy: r.sy }, system: r.index });
      io.out(`${address}  ${s.name} (${s.code})  ${s.stars.map((st) => st.label).join(' + ')}, ${s.planets.length} pianeti, ${s.belts.length} fasce, ${s.comets.length} comete`);
      return { buffer: systemView(s, g.sector(r.sx, r.sy), { size, tick, labels: true }), label: address };
    });
    const sheet = composeGrid(chunk(cells, Math.ceil(Math.sqrt(count))), { bg: true, title: `galassia ${g.seed}: ${count} sistemi a caso, tick ${tick}` });
    const scale = positiveInt(v, 'scale', 1);
    const path = outputPath(v.out, `systems-${g.seed}.png`);
    savePng(path, sheet, scale);
    io.out(`${path}  ${sheet.w}x${sheet.h} x${scale}`);
    return 0;
  },
};

export const census: Command = {
  name: 'census',
  usage: 'census [--galaxy n] [--count 10000] [--seed n]',
  summary: 'statistiche su molti sistemi scelti a caso (classi, molteplicità, pianeti, lune), confrontate con i valori attesi',
  options: {
    galaxy: { kind: 'int', value: 'n', doc: 'seed della galassia, default 0' },
    count: { kind: 'int', value: 'n', doc: 'quanti sistemi, default 10000' },
    seed: { kind: 'int', value: 'n', doc: 'seed della scelta, default 0' },
  },
  run(args, io) {
    const v = args.values;
    const g = new Galaxy(galaxySeed(v));
    const count = positiveInt(v, 'count', 10000);
    const c = censusOf(g, count, intOption(v, 'seed', 0));
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    io.out(`censimento di ${c.systems} sistemi della galassia ${g.seed}`);
    io.out(`classi:     ${Object.entries(c.classes).map(([k, x]) => `${k} ${pct(x)}`).join(', ')}`);
    io.out(`archetipi:  ${Object.entries(c.archetypes).map(([k, x]) => `${k} ${pct(x)}`).join(', ')}`);
    io.out(`zone:       ${Object.entries(c.zones).map(([k, x]) => `${ZONE_NAMES[k]} ${pct(x)}`).join(', ')}`);
    io.out(`multipli:   singoli ${pct(c.multiplicity[0])}, binari ${pct(c.multiplicity[1])}, tripli ${pct(c.multiplicity[2])}`);
    let failures = 0;
    for (const e of EXPECTED) {
      const x = e.value(c);
      const ok = x >= e.min && x <= e.max;
      if (!ok) failures++;
      const show = (n: number) => (e.share ? pct(n) : n.toFixed(2));
      io.out(`  ${ok ? 'ok  ' : 'FUORI'} ${e.label.padEnd(42)} ${show(x).padStart(7)}  atteso ${show(e.min)}..${show(e.max)}`);
    }
    io.out(failures === 0 ? 'tutti i valori nell\'intervallo atteso' : `${failures} valori fuori dall'intervallo atteso`);
    return failures === 0 ? 0 : 1;
  },
};
