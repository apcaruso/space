import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../core/buffer';
import { derive } from '../core/hash';
import { lightFromAngle } from '../toolkit/light';
import { attemptSeed, defineGenerator, Registry, type GeneratorDef } from './registry';
import { int, obj, type Fields } from './schema';

interface Probe {
  calls: { seed: number; size: number; frame: number }[];
  validatedSizes: number[];
}

/** A generator whose buffer encodes its seed; the validator accepts seeds divisible by `every`. */
function fake(probe: Probe, every = 1, maxAttempts?: number): GeneratorDef<Fields> {
  return defineGenerator({
    name: 'fake',
    version: 2,
    description: 'test',
    recipe: obj({ value: int(3, 0, 9) }),
    sizes: { default: 8, min: 4, max: 16 },
    loop: 4,
    goldens: [],
    maxAttempts,
    generate(r, seed, opts) {
      probe.calls.push({ seed, size: opts.size, frame: opts.frame });
      const buffer = new IndexedBuffer(opts.size, opts.size).fill((seed % 200) + 1);
      return { buffer, descriptor: { seed, value: r.value } };
    },
    validators: [
      {
        name: 'divisible',
        check(result) {
          probe.validatedSizes.push(result.buffer.w);
          const seed = result.descriptor.seed as number;
          return seed % every === 0 ? null : `seed ${seed} not divisible by ${every}`;
        },
      },
    ],
  });
}

const probe = (): Probe => ({ calls: [], validatedSizes: [] });

describe('Registry', () => {
  it('checks names and versions', () => {
    const p = probe();
    expect(() => new Registry([fake(p), fake(p)])).toThrow('registered twice');
    expect(() => new Registry([{ ...fake(p), name: 'Bad Name' }])).toThrow('lowercase');
    expect(() => new Registry([{ ...fake(p), version: 0 }])).toThrow('version');
    expect(() => new Registry([fake(p)]).get('nope')).toThrow('generatore sconosciuto "nope"; registrati: fake');
  });

  it('resolves recipes and options', () => {
    const reg = new Registry([fake(probe())]);
    const r = reg.run('fake', {}, 5);
    expect(r.id).toBe('fake@2');
    expect(r.recipe).toEqual({ value: 3 });
    expect(r.opts.size).toBe(8);
    expect(r.descriptor).toEqual({ seed: 5, value: 3 });
    expect(() => reg.run('fake', {}, 5, { size: 32 })).toThrow('tra 4 e 16');
    expect(() => reg.run('fake', {}, 5, { frame: 0.5 })).toThrow('intero');
    expect(() => reg.run('fake', { value: 12 }, 5)).toThrow('ricetta.value');
  });

  it('retries with derive(seed, "retry", n) until the validators pass', () => {
    const seed = 11;
    const firstGood = [1, 2, 3, 4, 5, 6, 7].find((n) => derive(seed, 'retry', n) % 3 === 0);
    expect(firstGood).toBeDefined();
    const r = new Registry([fake(probe(), 3)]).run('fake', {}, seed);
    expect(r.accepted).toBe(true);
    expect(r.attempt).toBe(firstGood);
    expect(r.seedUsed).toBe(derive(seed, 'retry', firstGood as number));
    expect(r.rejections.map((x) => x.attempt)).toEqual(Array.from({ length: firstGood as number }, (_, i) => i));
    expect(attemptSeed(seed, 0)).toBe(seed);
  });

  it('falls back to the first attempt when every attempt fails', () => {
    const r = new Registry([fake(probe(), 1_000_003, 4)]).run('fake', {}, 7);
    expect(r.accepted).toBe(false);
    expect(r.seedUsed).toBe(7);
    expect(r.rejections).toHaveLength(4);
    expect(r.rejections[0].reasons[0]).toEqual({ validator: 'divisible', reason: 'seed 7 not divisible by 1000003' });
  });

  it('validates on the canonical render, so size, frame and light never change the choice', () => {
    const p = probe();
    const reg = new Registry([fake(p, 3)]);
    const a = reg.run('fake', {}, 11);
    const b = reg.run('fake', {}, 11, { size: 12, frame: 9, lightDir: lightFromAngle(90, 20) });
    expect(b.seedUsed).toBe(a.seedUsed);
    expect(new Set(p.validatedSizes)).toEqual(new Set([8]));
    expect(b.buffer.w).toBe(12);
  });

  it('validates once for many frames and reuses the canonical render', () => {
    const p = probe();
    const reg = new Registry([fake(p)]);
    const frames = reg.runMany('fake', {}, 4, [{ frame: 0 }, { frame: 1 }, { frame: 2 }]);
    expect(frames.map((f) => f.opts.frame)).toEqual([0, 1, 2]);
    // One canonical render (also used for frame 0) plus frames 1 and 2.
    expect(p.calls.map((c) => c.frame)).toEqual([0, 1, 2]);
  });

  it('is deterministic', () => {
    const reg = new Registry([fake(probe(), 3)]);
    expect(reg.run('fake', {}, 99).buffer.data).toEqual(reg.run('fake', {}, 99).buffer.data);
  });
});
