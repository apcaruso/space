// Generator goldens: for each generator, the fingerprint and descriptor of a fixed set of
// (recipe, seed, options), stored in tests/golden/<name>.json.

import { existsSync, readFileSync } from 'node:fs';
import { fingerprint } from '../core/fingerprint';
import { DEFAULT_AZIMUTH, DEFAULT_ELEVATION, generatorId, type Descriptor, type Json, type Registry } from '../gen/registry';
import { lightFromAngle } from '../toolkit/light';

export const GOLDEN_DIR = 'tests/golden';

export interface GoldenRecord {
  readonly seed: number;
  readonly recipe: Json;
  readonly size: number;
  readonly frame: number;
  readonly light: number;
  readonly seedUsed: number;
  readonly fingerprint: string;
  readonly descriptor: Descriptor;
}

export interface GoldenFile {
  readonly id: string;
  readonly cases: readonly GoldenRecord[];
}

export function goldenPath(name: string): string {
  return `${GOLDEN_DIR}/${name}.json`;
}

export function computeGolden(registry: Registry, name: string): GoldenFile {
  const def = registry.get(name);
  const cases = def.goldens.map((c) => {
    const size = c.size ?? def.sizes.default;
    const frame = c.frame ?? 0;
    const light = c.light ?? DEFAULT_AZIMUTH;
    const recipe = c.recipe ?? {};
    const r = registry.run(name, recipe, c.seed, { size, frame, lightDir: lightFromAngle(light, DEFAULT_ELEVATION) });
    return { seed: c.seed, recipe, size, frame, light, seedUsed: r.seedUsed, fingerprint: fingerprint(r.buffer), descriptor: r.descriptor };
  });
  return { id: generatorId(def), cases };
}

export function formatGolden(file: GoldenFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function describeCase(c: GoldenRecord, i: number): string {
  return `caso ${i} (seed ${c.seed}, lato ${c.size}, frame ${c.frame}, luce ${c.light}, ricetta ${JSON.stringify(c.recipe)})`;
}

/** Problems found comparing the generator with its golden file; empty when they match. */
export function checkGolden(registry: Registry, name: string): string[] {
  const path = goldenPath(name);
  if (!existsSync(path)) return [`${name}: manca il file golden ${path}; esegui "forge golden update ${name}"`];
  const text = readFileSync(path, 'utf8');
  const stored = JSON.parse(text) as GoldenFile;
  const current = computeGolden(registry, name);
  if (formatGolden(current) === text) return [];

  const hint = `esegui "forge golden update ${name}" solo se il cambiamento è voluto`;
  if (stored.id !== current.id) return [`${name}: il file golden è per ${stored.id}, il generatore ora è ${current.id}; ${hint}`];
  const problems: string[] = [];
  if (stored.cases.length !== current.cases.length) problems.push(`${name}: ${stored.cases.length} casi golden salvati, ${current.cases.length} definiti`);
  current.cases.forEach((c, i) => {
    const s = stored.cases[i];
    if (s === undefined) return;
    const what = describeCase(c, i);
    if (JSON.stringify({ ...s, fingerprint: '', descriptor: {}, seedUsed: 0 }) !== JSON.stringify({ ...c, fingerprint: '', descriptor: {}, seedUsed: 0 })) {
      problems.push(`${name} ${what}: la definizione del caso è diversa da quella salvata`);
      return;
    }
    if (s.seedUsed !== c.seedUsed) problems.push(`${name} ${what}: seed accettato ${s.seedUsed} -> ${c.seedUsed}`);
    if (s.fingerprint !== c.fingerprint) problems.push(`${name} ${what}: pixel cambiati ${s.fingerprint} -> ${c.fingerprint}`);
    if (JSON.stringify(s.descriptor) !== JSON.stringify(c.descriptor)) {
      problems.push(`${name} ${what}: descrittore ${JSON.stringify(s.descriptor)} -> ${JSON.stringify(c.descriptor)}`);
    }
  });
  if (problems.length === 0) problems.push(`${name}: il file golden differisce nella formattazione; ${hint}`);
  problems.push(`${name}: l'output è cambiato senza alzare la versione; alza la versione in gen/${name}.ts oppure ${hint}`);
  return problems;
}
