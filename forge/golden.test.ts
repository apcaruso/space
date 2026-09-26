import { describe, expect, it } from 'vitest';
import { registry } from '../gen/index';
import { Registry } from '../gen/registry';
import { testdisc } from '../gen/testdisc';
import { checkGolden } from './golden';

describe('generator goldens', () => {
  it('match tests/golden for every registered generator', () => {
    for (const def of registry.list()) expect(checkGolden(registry, def.name)).toEqual([]);
  });

  it('catch a changed output that kept its version', () => {
    const changed = new Registry([
      {
        ...testdisc,
        generate(recipe, seed, opts) {
          const r = testdisc.generate(recipe, seed, opts);
          r.buffer.set(0, 0, 1);
          return r;
        },
      },
    ]);
    const problems = checkGolden(changed, 'testdisc');
    expect(problems.some((p) => p.includes('pixel cambiati'))).toBe(true);
    expect(problems.at(-1)).toContain("l'output è cambiato senza alzare la versione");
  });

  it('ask for an update after a version bump', () => {
    const bumped = new Registry([{ ...testdisc, version: 2 }]);
    expect(checkGolden(bumped, 'testdisc')).toEqual([
      'testdisc: il file golden è per testdisc@1, il generatore ora è testdisc@2; esegui "forge golden update testdisc" solo se il cambiamento è voluto',
    ]);
  });
});
