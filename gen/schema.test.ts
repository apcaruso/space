import { describe, expect, it } from 'vitest';
import { bool, choice, defaults, describeSchema, fieldAt, int, num, obj, parseFieldText, parseRecipe, RecipeError, withValue } from './schema';

const schema = obj({
  radius: num(0.5, 0, 1, 'size'),
  ramp: choice(['rock', 'sand', 'ice'], 'rock'),
  noise: obj({ octaves: int(4, 1, 8), warp: bool(false) }),
});

function issues(input: unknown): readonly string[] {
  try {
    parseRecipe(schema, input);
  } catch (e) {
    if (e instanceof RecipeError) return e.issues;
    throw e;
  }
  return [];
}

describe('parseRecipe', () => {
  it('fills defaults, nested ones included, with sorted keys', () => {
    const r = parseRecipe(schema, { noise: { warp: true } });
    expect(r).toEqual({ noise: { octaves: 4, warp: true }, radius: 0.5, ramp: 'rock' });
    expect(Object.keys(r)).toEqual(['noise', 'radius', 'ramp']);
    expect(parseRecipe(schema, undefined)).toEqual(defaults(schema));
  });

  it('reports every problem with its path', () => {
    expect(issues({ radius: 2, ramp: 'snd', noise: { octaves: 2.5, warp: 'yes', extra: 1 }, radious: 1 })).toEqual([
      'ricetta.noise.extra: campo sconosciuto; campi validi: octaves, warp',
      'ricetta.noise.octaves: atteso un intero tra 1 e 8, ricevuto 2.5',
      'ricetta.noise.warp: atteso true o false, ricevuto "yes"',
      'ricetta.radious: campo sconosciuto (forse intendevi "radius"?); campi validi: noise, radius, ramp',
      'ricetta.radius: atteso un numero tra 0 e 1, ricevuto 2',
      'ricetta.ramp: atteso uno tra "rock", "sand", "ice", ricevuto "snd" (forse intendevi "sand"?)',
    ]);
  });

  it('rejects inputs that are not objects', () => {
    expect(issues([1, 2])).toEqual(['ricetta: atteso un oggetto, ricevuto un array']);
    expect(issues({ noise: 3 })).toEqual(['ricetta.noise: atteso un oggetto, ricevuto 3']);
    expect(issues({ radius: null })).toEqual(['ricetta.radius: atteso un numero tra 0 e 1, ricevuto null']);
  });

  it('formats a readable error message', () => {
    expect(() => parseRecipe(schema, { radius: -1 })).toThrow('ricetta non valida:\n  - ricetta.radius: atteso un numero tra 0 e 1, ricevuto -1');
  });
});

describe('schema helpers', () => {
  it('rejects defaults outside their own range', () => {
    expect(() => num(2, 0, 1)).toThrow();
    expect(() => int(1.5, 0, 3)).toThrow();
    expect(() => choice(['a', 'b'], 'c' as 'a')).toThrow();
  });

  it('finds fields by dotted path', () => {
    expect(fieldAt(schema, 'noise.octaves')).toMatchObject({ kind: 'number', integer: true });
    expect(() => fieldAt(schema, 'noise.octave')).toThrow('ricetta.noise.octave: campo sconosciuto (forse intendevi "octaves"?)');
    expect(() => fieldAt(schema, 'radius.x')).toThrow('ricetta.radius non è un oggetto');
  });

  it('parses command-line text by field type', () => {
    expect(parseFieldText(fieldAt(schema, 'radius'), '0.25')).toBe(0.25);
    expect(parseFieldText(fieldAt(schema, 'radius'), 'big')).toBe('big');
    expect(parseFieldText(fieldAt(schema, 'noise.warp'), 'true')).toBe(true);
    expect(parseFieldText(fieldAt(schema, 'ramp'), 'ice')).toBe('ice');
  });

  it('sets values by path without touching the input', () => {
    const input = { noise: { octaves: 2 } };
    expect(withValue(input, 'noise.warp', true)).toEqual({ noise: { octaves: 2, warp: true } });
    expect(withValue(undefined, 'noise.octaves', 5)).toEqual({ noise: { octaves: 5 } });
    expect(input).toEqual({ noise: { octaves: 2 } });
  });

  it('describes every leaf field', () => {
    expect(describeSchema(schema)).toEqual([
      'noise.octaves: intero 1..8 = 4',
      'noise.warp: booleano = false',
      'radius: numero 0..1 = 0.5  size',
      'ramp: uno tra rock|sand|ice = rock',
    ]);
  });
});
