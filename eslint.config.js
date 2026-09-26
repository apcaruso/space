// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Pure, deterministic modules: same bytes in Node and in the browser (see CLAUDE.md).
const PURE = ['core', 'toolkit', 'gen', 'universe'];
const ts = (dir) => `${dir}/**/*.ts`;
const tests = (dir) => `${dir}/**/*.test.ts`;

// Rule 5: only + - * / and Math.sqrt are bit-identical across JS engines.
const NON_PORTABLE_MATH = [
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'exp', 'expm1', 'log', 'log1p', 'log2', 'log10',
  'pow', 'hypot', 'cbrt',
];

const LOCALE_DEPENDENT = ['toLocaleString', 'toLocaleUpperCase', 'toLocaleLowerCase', 'localeCompare'];

const IMPURE_GLOBALS = [
  'window', 'self', 'document', 'navigator', 'globalThis',
  'process', 'Buffer', 'require', 'fetch', 'localStorage', 'sessionStorage',
  'setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'queueMicrotask',
];

const determinismRules = {
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Regola 2: niente Math.random, usa un seed derivato con derive(seed, "nome").' },
    ...NON_PORTABLE_MATH.map((property) => ({
      object: 'Math',
      property,
      message: `Regola 5: Math.${property} non è bit-identico tra motori JS, usa core/dmath.`,
    })),
    ...LOCALE_DEPENDENT.map((property) => ({
      property,
      message: `${property} dipende dalla locale dell'ambiente.`,
    })),
  ],
  'no-restricted-globals': [
    'error',
    { name: 'Date', message: "Regole 2 e 6: niente orologio, il tempo è un tick intero passato dall'esterno." },
    { name: 'performance', message: "Regole 2 e 6: niente orologio, il tempo è un tick intero passato dall'esterno." },
    { name: 'crypto', message: 'Regola 2: niente casualità, usa un seed derivato.' },
    { name: 'Intl', message: "Intl dipende dalla locale dell'ambiente." },
    ...IMPURE_GLOBALS.map((name) => ({
      name,
      message: `${name}: i moduli puri non accedono a DOM, Node, timer o I/O.`,
    })),
  ],
  'no-restricted-syntax': [
    'error',
    { selector: "BinaryExpression[operator='**']", message: 'Regola 5: ** equivale a Math.pow, usa moltiplicazioni o core/dmath.' },
    { selector: "AssignmentExpression[operator='**=']", message: 'Regola 5: **= equivale a Math.pow, usa moltiplicazioni o core/dmath.' },
    { selector: 'ForInStatement', message: 'Regola 9: itera su array o su chiavi ordinate, non con for...in.' },
  ],
};

// Allowed dependencies between modules (see "Dipendenze tra moduli" in docs/DESIGN.md).
const FORBIDDEN_IMPORTS = {
  core: ['toolkit', 'gen', 'universe', 'forge', 'app'],
  toolkit: ['gen', 'universe', 'forge', 'app'],
  gen: ['forge', 'app'],
  universe: ['toolkit', 'gen', 'forge', 'app'],
  app: ['forge'],
};

const NO_PACKAGES = {
  regex: '^(?!\\.\\.?/)',
  message: 'Nessuna dipendenza esterna in core/, toolkit/, gen/, universe/: solo import relativi.',
};

function importRule(layer, { packages }) {
  const patterns = FORBIDDEN_IMPORTS[layer].map((dir) => ({
    regex: `^(\\.\\./)+${dir}(/|$)`,
    message: `${layer}/ non può importare da ${dir}/ (vedi docs/DESIGN.md, "Dipendenze tra moduli").`,
  }));
  if (!packages) patterns.push(NO_PACKAGES);
  return { 'no-restricted-imports': ['error', { patterns }] };
}

export default defineConfig(
  { ignores: ['node_modules/', 'dist/', 'out/', 'coverage/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: PURE.map(ts),
    rules: determinismRules,
  },
  ...PURE.map((layer) => ({
    files: [ts(layer)],
    ignores: [tests(layer)],
    rules: importRule(layer, { packages: false }),
  })),
  // Tests in pure modules may import vitest, but keep the determinism and layering rules.
  ...PURE.map((layer) => ({
    files: [tests(layer)],
    rules: importRule(layer, { packages: true }),
  })),
  {
    files: [ts('app')],
    rules: importRule('app', { packages: true }),
  },
);
