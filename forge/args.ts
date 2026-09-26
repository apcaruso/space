// Minimal argument parser with readable errors: `--name value`, `--name=value`, `-o value`,
// boolean flags, and positionals.

export type OptionKind = 'int' | 'number' | 'string' | 'flag' | 'seeds' | 'list';

export interface OptionSpec {
  readonly kind: OptionKind;
  readonly doc: string;
  /** Placeholder shown in the usage line. */
  readonly value?: string;
  /** Single-letter alias, e.g. "o" for --out. */
  readonly short?: string;
}

export type OptionSpecs = { readonly [name: string]: OptionSpec };

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly values: { readonly [name: string]: number | string | boolean | readonly number[] | readonly string[] };
}

/** Wrong command-line usage; the message is shown as is. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function closest(input: string, options: readonly string[]): string {
  let best = '';
  let bestD = 3;
  for (const o of options) {
    let d = Math.abs(o.length - input.length);
    for (let i = 0; i < Math.min(o.length, input.length); i++) if (o[i] !== input[i]) d++;
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best === '' ? '' : ` (forse intendevi --${best}?)`;
}

/** "0..7" (inclusive), "1,5,9" or "3". */
export function parseSeeds(text: string): number[] {
  const range = /^(-?\d+)\.\.(-?\d+)$/.exec(text);
  if (range !== null) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (b < a || b - a > 4096) throw new UsageError(`intervallo di seed non valido "${text}": usa a..b con a <= b e al massimo 4096 seed`);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return text.split(',').map((part) => {
    if (!/^-?\d+$/.test(part.trim())) throw new UsageError(`lista di seed non valida "${text}": usa "0..7" oppure "1,5,9"`);
    return Number(part.trim());
  });
}

function convert(name: string, spec: OptionSpec, text: string): number | string | readonly number[] | readonly string[] {
  switch (spec.kind) {
    case 'int':
      if (!/^-?\d+$/.test(text)) throw new UsageError(`--${name} vuole un intero, ricevuto "${text}"`);
      return Number(text);
    case 'number': {
      const v = Number(text);
      if (text.trim() === '' || !Number.isFinite(v)) throw new UsageError(`--${name} vuole un numero, ricevuto "${text}"`);
      return v;
    }
    case 'seeds':
      return parseSeeds(text);
    case 'list':
      return text.split(',').map((s) => s.trim());
    default:
      return text;
  }
}

export function parseArgs(argv: readonly string[], specs: OptionSpecs): ParsedArgs {
  const names = Object.keys(specs).sort();
  const byShort = new Map(names.filter((n) => specs[n].short !== undefined).map((n) => [specs[n].short as string, n]));
  const positionals: string[] = [];
  const values: Record<string, number | string | boolean | readonly number[] | readonly string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-') || arg === '-' || /^-\d/.test(arg)) {
      positionals.push(arg);
      continue;
    }
    let name: string;
    let inline: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      inline = eq === -1 ? undefined : arg.slice(eq + 1);
    } else {
      const long = byShort.get(arg.slice(1));
      if (long === undefined) throw new UsageError(`opzione sconosciuta ${arg}`);
      name = long;
    }
    const spec = specs[name];
    if (spec === undefined) throw new UsageError(`opzione sconosciuta --${name}${closest(name, names)}`);
    if (name in values) throw new UsageError(`--${name} ripetuta due volte`);
    if (spec.kind === 'flag') {
      if (inline !== undefined) throw new UsageError(`--${name} non prende valori`);
      values[name] = true;
      continue;
    }
    const text = inline ?? argv[++i];
    if (text === undefined) throw new UsageError(`--${name} vuole un valore (${spec.value ?? spec.kind})`);
    values[name] = convert(name, spec, text);
  }
  return { positionals, values };
}

/** Usage lines for a set of options, aligned. */
export function describeOptions(specs: OptionSpecs): string[] {
  const names = Object.keys(specs).sort();
  const heads = names.map((n) => {
    const s = specs[n];
    const short = s.short === undefined ? '' : `-${s.short}, `;
    return `${short}--${n}${s.kind === 'flag' ? '' : ` <${s.value ?? s.kind}>`}`;
  });
  const width = Math.max(...heads.map((h) => h.length));
  return names.map((n, i) => `  ${heads[i].padEnd(width)}  ${specs[n].doc}`);
}
