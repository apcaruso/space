// Commands that check generators without drawing: lint, golden, list.

import { registry } from '../../gen/index';
import { generatorId } from '../../gen/registry';
import { describeSchema } from '../../gen/schema';
import { UsageError } from '../args';
import { generatorName, positiveInt, readRecipe, writeOutput, type Command } from '../common';
import { checkGolden, computeGolden, formatGolden, goldenPath } from '../golden';

export const lint: Command = {
  name: 'lint',
  usage: 'lint <gen> [--count 256] [--from n] [--recipe f.json]',
  summary: 'esegue i validatori su molti seed: quanti falliscono e perché',
  options: {
    count: { kind: 'int', value: 'n', doc: 'numero di seed, default 256' },
    from: { kind: 'int', value: 'n', doc: 'primo seed, default 0' },
    recipe: { kind: 'string', value: 'file.json', doc: 'ricetta JSON; i campi mancanti prendono i default' },
  },
  run(args, io) {
    const name = generatorName(args, 'lint');
    const v = args.values;
    const count = positiveInt(v, 'count', 256);
    const from = typeof v.from === 'number' ? v.from : 0;
    const def = registry.get(name);
    const validators = def.validators ?? [];
    if (validators.length === 0) {
      io.out(`${generatorId(def)}: nessun validatore`);
      return 0;
    }
    const recipe = readRecipe(v.recipe);
    const byValidator = new Map<string, number>(validators.map((x) => [x.name, 0]));
    const examples = new Map<string, string[]>();
    let firstTry = 0;
    let retried = 0;
    let maxAttempt = 0;
    const unresolved: number[] = [];
    for (let seed = from; seed < from + count; seed++) {
      const sel = registry.select(name, recipe, seed);
      if (sel.accepted && sel.attempt === 0) firstTry++;
      if (sel.accepted && sel.attempt > 0) retried++;
      if (!sel.accepted) unresolved.push(seed);
      maxAttempt = Math.max(maxAttempt, sel.attempt);
      const first = sel.rejections[0];
      if (first !== undefined && first.attempt === 0) {
        for (const r of first.reasons) {
          byValidator.set(r.validator, (byValidator.get(r.validator) ?? 0) + 1);
          const list = examples.get(r.validator) ?? [];
          if (list.length < 3) list.push(`seed ${seed}: ${r.reason}`);
          examples.set(r.validator, list);
        }
      }
    }
    const pct = (n: number) => `${((100 * n) / count).toFixed(1)}%`;
    io.out(`${generatorId(def)}: ${count} seed da ${from}`);
    io.out(`  passati al primo tentativo: ${firstTry} (${pct(firstTry)})`);
    io.out(`  passati dopo ritentativi: ${retried}${retried > 0 ? `, fino al tentativo ${maxAttempt}` : ''}`);
    io.out(`  falliti a ogni tentativo: ${unresolved.length}${unresolved.length > 0 ? ` (seed ${unresolved.slice(0, 10).join(', ')})` : ''}`);
    io.out('  fallimenti al primo tentativo, per validatore:');
    for (const x of validators) {
      const n = byValidator.get(x.name) ?? 0;
      io.out(`    ${x.name}: ${n} (${pct(n)})`);
      for (const e of examples.get(x.name) ?? []) io.out(`      ${e}`);
    }
    return unresolved.length === 0 ? 0 : 1;
  },
};

export const golden: Command = {
  name: 'golden',
  usage: 'golden check|update [gen]',
  summary: "confronta l'output con tests/golden/<gen>.json, o lo riscrive consapevolmente",
  options: {},
  run(args, io) {
    const [action, only, extra] = args.positionals;
    if (action !== 'check' && action !== 'update') throw new UsageError('golden: usa "golden check [gen]" oppure "golden update [gen]"');
    if (extra !== undefined) throw new UsageError(`golden: argomento inatteso "${extra}"`);
    const names = only === undefined ? registry.list().map((d) => d.name) : [registry.get(only).name];
    if (action === 'update') {
      for (const name of names) {
        const file = computeGolden(registry, name);
        writeOutput(goldenPath(name), formatGolden(file));
        io.out(`${goldenPath(name)}  ${file.id}, ${file.cases.length} casi`);
      }
      return 0;
    }
    let failed = 0;
    for (const name of names) {
      const problems = checkGolden(registry, name);
      if (problems.length === 0) {
        io.out(`${name}: ok`);
      } else {
        failed++;
        for (const p of problems) io.err(p);
      }
    }
    return failed === 0 ? 0 : 1;
  },
};

export const list: Command = {
  name: 'list',
  usage: 'list',
  summary: 'generatori registrati con versione, dimensioni e parametri della ricetta',
  options: {},
  run(args, io) {
    if (args.positionals.length > 0) throw new UsageError(`list: argomento inatteso "${args.positionals[0]}"`);
    for (const def of registry.list()) {
      io.out(`${generatorId(def)}  ${def.description}`);
      io.out(`  lato ${def.sizes.min}..${def.sizes.max} (default ${def.sizes.default}), giro di ${def.loop} frame, ${def.goldens.length} casi golden`);
      const validators = (def.validators ?? []).map((x) => x.name);
      io.out(`  validatori: ${validators.length === 0 ? 'nessuno' : validators.join(', ')}`);
      io.out('  ricetta:');
      for (const line of describeSchema(def.recipe)) io.out(`    ${line}`);
    }
    return 0;
  },
};
