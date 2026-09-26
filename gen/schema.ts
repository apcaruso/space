// Declarative recipe schemas: defaults, ranges and readable errors. No dependencies, so the app
// can validate recipes too. Fields are visited in sorted key order, and resolved recipes carry
// their keys sorted, so the same recipe always serialises the same way.

export interface NumberField {
  readonly kind: 'number';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  readonly doc: string;
}

export interface BooleanField {
  readonly kind: 'boolean';
  readonly default: boolean;
  readonly doc: string;
}

export interface ChoiceField<V extends string = string> {
  readonly kind: 'choice';
  readonly default: V;
  readonly values: readonly V[];
  readonly doc: string;
}

export interface ObjectField<F extends Fields = Fields> {
  readonly kind: 'object';
  readonly fields: F;
  readonly doc: string;
}

export type Field = NumberField | BooleanField | ChoiceField | ObjectField;
export type Fields = { readonly [key: string]: Field };

/** The value type a field describes. */
export type Infer<F> = F extends NumberField
  ? number
  : F extends BooleanField
    ? boolean
    : F extends ChoiceField<infer V>
      ? V
      : F extends ObjectField<infer S>
        ? { -readonly [K in keyof S]: Infer<S[K]> }
        : never;

export function num(def: number, min: number, max: number, doc = ''): NumberField {
  return checkRange({ kind: 'number', default: def, min, max, integer: false, doc });
}

export function int(def: number, min: number, max: number, doc = ''): NumberField {
  return checkRange({ kind: 'number', default: def, min, max, integer: true, doc });
}

export function bool(def: boolean, doc = ''): BooleanField {
  return { kind: 'boolean', default: def, doc };
}

export function choice<V extends string>(values: readonly V[], def: V, doc = ''): ChoiceField<V> {
  if (!values.includes(def)) throw new Error(`schema: default "${def}" is not one of ${values.join(', ')}`);
  return { kind: 'choice', default: def, values, doc };
}

export function obj<F extends Fields>(fields: F, doc = ''): ObjectField<F> {
  return { kind: 'object', fields, doc };
}

function checkRange(f: NumberField): NumberField {
  const ok = f.min <= f.default && f.default <= f.max && (!f.integer || Number.isInteger(f.default));
  if (!ok) throw new Error(`schema: default ${f.default} outside ${f.min}..${f.max}`);
  return f;
}

/** Invalid recipe: every problem found, one readable line each (in Italian, like the CLI). */
export class RecipeError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`ricetta non valida:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'RecipeError';
    this.issues = issues;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'un array';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') return 'un oggetto';
  return String(value);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

function suggestion(input: string, options: readonly string[]): string {
  let best = '';
  let bestD = 3;
  for (const o of options) {
    const d = editDistance(input, o);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  return best === '' ? '' : ` (forse intendevi "${best}"?)`;
}

function rangeText(f: NumberField): string {
  return `${f.integer ? 'un intero' : 'un numero'} tra ${f.min} e ${f.max}`;
}

function parseField(f: Field, value: unknown, path: string, issues: string[]): unknown {
  if (value === undefined) return defaults(f);
  switch (f.kind) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < f.min || value > f.max || (f.integer && !Number.isInteger(value))) {
        issues.push(`${path}: atteso ${rangeText(f)}, ricevuto ${describe(value)}`);
        return f.default;
      }
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') {
        issues.push(`${path}: atteso true o false, ricevuto ${describe(value)}`);
        return f.default;
      }
      return value;
    case 'choice':
      if (typeof value !== 'string' || !f.values.includes(value)) {
        const hint = typeof value === 'string' ? suggestion(value, f.values) : '';
        issues.push(`${path}: atteso uno tra ${f.values.map((v) => `"${v}"`).join(', ')}, ricevuto ${describe(value)}${hint}`);
        return f.default;
      }
      return value;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        issues.push(`${path}: atteso un oggetto, ricevuto ${describe(value)}`);
        return defaults(f);
      }
      const input = value as Record<string, unknown>;
      const keys = Object.keys(f.fields).sort();
      for (const k of Object.keys(input).sort()) {
        if (!keys.includes(k)) issues.push(`${path}.${k}: campo sconosciuto${suggestion(k, keys)}; campi validi: ${keys.join(', ')}`);
      }
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = parseField(f.fields[k], input[k], `${path}.${k}`, issues);
      return out;
    }
  }
}

/** Default value of a field (a full object for object fields). */
export function defaults<F extends Field>(f: F): Infer<F> {
  if (f.kind !== 'object') return f.default as Infer<F>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(f.fields).sort()) out[k] = defaults(f.fields[k]);
  return out as Infer<F>;
}

/**
 * Validates a recipe and fills in defaults. Throws a RecipeError listing every problem, sorted by path.
 * Missing fields take their default; unknown fields, wrong types and out-of-range values are errors.
 */
export function parseRecipe<F extends Fields>(schema: ObjectField<F>, input: unknown): Infer<ObjectField<F>> {
  const issues: string[] = [];
  const value = parseField(schema, input ?? {}, 'ricetta', issues);
  if (issues.length > 0) throw new RecipeError(issues.sort());
  return value as Infer<ObjectField<F>>;
}

/** The field at a dotted path ("noise.octaves"); throws a readable error if there is none. */
export function fieldAt(schema: ObjectField, path: string): Field {
  let f: Field = schema;
  let at = 'ricetta';
  for (const part of path.split('.')) {
    if (f.kind !== 'object') throw new RecipeError([`${at} non è un oggetto, quindi non ha il campo "${part}"`]);
    const keys = Object.keys(f.fields).sort();
    const next: Field | undefined = f.fields[part];
    if (next === undefined) throw new RecipeError([`${at}.${part}: campo sconosciuto${suggestion(part, keys)}; campi validi: ${keys.join(', ')}`]);
    f = next;
    at = `${at}.${part}`;
  }
  return f;
}

/** Converts command-line text to a value for a field; the recipe check then validates it. */
export function parseFieldText(f: Field, text: string): unknown {
  switch (f.kind) {
    case 'number': {
      const v = Number(text);
      return text.trim() === '' || Number.isNaN(v) ? text : v;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
    case 'choice':
      return text;
    case 'object':
      throw new RecipeError([`un oggetto intero non si imposta da testo: "${text}"`]);
  }
}

/** Copy of a recipe input with the value at a dotted path replaced. */
export function withValue(input: unknown, path: string, value: unknown): Record<string, unknown> {
  // Recipes are plain JSON, so a JSON round trip is a full copy.
  const root = (typeof input === 'object' && input !== null ? JSON.parse(JSON.stringify(input)) : {}) as Record<string, unknown>;
  const parts = path.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    const child = node[part];
    if (typeof child !== 'object' || child === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
  return root;
}

/** One line per leaf field: path, type, range, default and doc. */
export function describeSchema(schema: ObjectField, prefix = ''): string[] {
  const lines: string[] = [];
  for (const k of Object.keys(schema.fields).sort()) {
    const f = schema.fields[k];
    const path = prefix === '' ? k : `${prefix}.${k}`;
    const doc = f.doc === '' ? '' : `  ${f.doc}`;
    switch (f.kind) {
      case 'object':
        lines.push(...describeSchema(f, path));
        break;
      case 'number':
        lines.push(`${path}: ${f.integer ? 'intero' : 'numero'} ${f.min}..${f.max} = ${f.default}${doc}`);
        break;
      case 'boolean':
        lines.push(`${path}: booleano = ${f.default}${doc}`);
        break;
      case 'choice':
        lines.push(`${path}: uno tra ${f.values.join('|')} = ${f.default}${doc}`);
        break;
    }
  }
  return lines;
}
