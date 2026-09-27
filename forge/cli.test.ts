import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runCli } from './run';

const DIR = 'out/test-cli';

function cli(...argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function png(path: string): PNG {
  return PNG.sync.read(readFileSync(path));
}

beforeAll(() => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
});

describe('forge CLI end to end on testdisc', () => {
  it('lists the registered generators', () => {
    const r = cli('list');
    expect(r.code).toBe(0);
    expect(r.out).toContain('testdisc@1');
    expect(r.out).toContain('noise.octaves: intero 1..8 = 4');
  });

  it('renders a PNG at an integer scale and prints the descriptor', () => {
    const r = cli('render', 'testdisc', '--seed', '3', '--scale', '5', '--bg', '-o', `${DIR}/render.png`);
    expect(r.code).toBe(0);
    expect(r.out).toContain('descrittore {"radius":23');
    const img = png(`${DIR}/render.png`);
    expect([img.width, img.height]).toEqual([240, 240]);
    // Nearest-neighbour: every 5x5 block is a single colour.
    for (let y = 0; y < 240; y += 5) {
      for (let x = 0; x < 240; x += 5) {
        const at = (dx: number, dy: number) => img.data.readUInt32BE(((y + dy) * 240 + x + dx) * 4);
        expect(at(4, 4)).toBe(at(0, 0));
      }
    }
  });

  it('writes sheets, params sheets and animations', () => {
    expect(cli('sheet', 'testdisc', '--count', '6', '--cols', '3', '--bg', '-o', `${DIR}/sheet.png`).code).toBe(0);
    expect(png(`${DIR}/sheet.png`).width).toBeGreaterThan(3 * 48 * 2);
    const p = cli('params', 'testdisc', '--param', 'noise.scale', '--values', '1,2,4', '--seeds', '0..1', '-o', `${DIR}/params.png`);
    expect(p.code).toBe(0);
    expect(p.out).toContain('noise.scale = 1, 2, 4');
    const a = cli('anim', 'testdisc', '--frames', '6', '--fps', '10', '--strip', '-o', `${DIR}/anim.gif`);
    expect(a.code).toBe(0);
    expect(readFileSync(`${DIR}/anim.gif`).subarray(0, 6).toString()).toBe('GIF89a');
    expect(png(`${DIR}/anim-strip.png`).width).toBeGreaterThan(0);
  });

  it('shows one object at several sizes', () => {
    const r = cli('sizes', 'planet', '--sizes', '16,32,48', '--seed', '4', '--bg', '-o', `${DIR}/sizes.png`);
    expect(r.code).toBe(0);
    expect(r.out).toContain('lati 16, 32, 48');
    expect(png(`${DIR}/sizes.png`).width).toBeGreaterThan((16 + 32 + 48) * 2);
  });

  it('glues background chunks and composes scenes', () => {
    const c = cli('chunks', 'background', '--x', '0..1', '--y', '0', '--size', '64', '-o', `${DIR}/chunks.png`);
    expect(c.code).toBe(0);
    expect([png(`${DIR}/chunks.png`).width, png(`${DIR}/chunks.png`).height]).toEqual([128, 64]);
    expect(cli('chunks', 'planet').err).toContain('non ha chunk.x e chunk.y');
    const s = cli('scene', 'recipes/scenes/step5.json', '--scale', '1', '-o', `${DIR}/scene.png`);
    expect(s.code).toBe(0);
    expect([png(`${DIR}/scene.png`).width, png(`${DIR}/scene.png`).height]).toEqual([480, 270]);
    writeFileSync(`${DIR}/bad-scene.json`, JSON.stringify({ width: 10, objects: [{ gen: 'star', x: 1.5 }] }));
    const bad = cli('scene', `${DIR}/bad-scene.json`);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('width e height devono essere interi positivi');
    expect(bad.err).toContain('objects[0].x: atteso un intero');
  });

  it('produces byte-identical files when a command runs twice', () => {
    const runs: [string, string[]][] = [
      ['render.png', ['render', 'testdisc', '--seed', '9', '--frame', '5', '--light', '100', '--grid']],
      ['sheet.png', ['sheet', 'testdisc', '--count', '8', '--from', '20']],
      ['params.png', ['params', 'testdisc', '--param', 'relief', '--values', '0,0.3', '--seeds', '1,4']],
      ['anim.gif', ['anim', 'testdisc', '--frames', '8', '--seed', '2']],
    ];
    for (const [file, argv] of runs) {
      expect(cli(...argv, '-o', `${DIR}/a-${file}`).code).toBe(0);
      expect(cli(...argv, '-o', `${DIR}/b-${file}`).code).toBe(0);
      expect(readFileSync(`${DIR}/b-${file}`).equals(readFileSync(`${DIR}/a-${file}`))).toBe(true);
    }
  });

  it('lints and checks goldens', () => {
    const lint = cli('lint', 'testdisc', '--count', '16');
    expect(lint.code).toBe(0);
    expect(lint.out).toContain('passati al primo tentativo: 16 (100.0%)');
    const golden = cli('golden', 'check');
    expect(golden.err).toBe('');
    expect(golden.code).toBe(0);
    expect(golden.out).toBe('asteroid: ok\nbackground: ok\nplanet: ok\nstar: ok\ntestdisc: ok');
  });
});

describe('forge CLI errors', () => {
  it('explains an invalid recipe field by field', () => {
    writeFileSync(`${DIR}/bad.json`, JSON.stringify({ land: 'vegetaton', noise: { octaves: 12 }, seaLevl: 0 }));
    const r = cli('render', 'testdisc', '--recipe', `${DIR}/bad.json`, '-o', `${DIR}/never.png`);
    expect(r.code).toBe(1);
    expect(r.err).toContain('forge render: ricetta non valida:');
    expect(r.err).toContain('ricetta.land: atteso uno tra');
    expect(r.err).toContain('(forse intendevi "vegetation"?)');
    expect(r.err).toContain('ricetta.noise.octaves: atteso un intero tra 1 e 8, ricevuto 12');
    expect(r.err).toContain('ricetta.seaLevl: campo sconosciuto (forse intendevi "seaLevel"?)');
  });

  it('rejects bad JSON, bad options, unknown generators and paths outside out/', () => {
    writeFileSync(`${DIR}/broken.json`, '{ "land": ');
    expect(cli('render', 'testdisc', '--recipe', `${DIR}/broken.json`).err).toContain('non è JSON valido');
    const typo = cli('render', 'testdisc', '--sizee', '32');
    expect(typo.code).toBe(1);
    expect(typo.err).toContain('opzione sconosciuta --sizee (forse intendevi --size?)');
    expect(typo.err).toContain('uso: npm run forge -- render <gen>');
    expect(cli('render', 'testdisc', '--size', 'big').err).toContain('--size vuole un intero, ricevuto "big"');
    expect(cli('render', 'testdisc', '--size', '999').err).toContain('la dimensione deve essere un intero tra 16 e 256');
    expect(cli('render', 'moon').err).toContain('generatore sconosciuto "moon"; registrati: asteroid, background, planet, star, testdisc');
    expect(cli('render', 'testdisc', '-o', 'elsewhere.png').err).toContain("l'uscita deve stare dentro out/");
    expect(cli('params', 'testdisc', '--param', 'noise.octave', '--values', '1').err).toContain('forse intendevi "octaves"?');
    expect(cli('params', 'testdisc', '--param', 'relief', '--values', '0.1,9').err).toContain('ricetta.relief: atteso un numero tra 0 e 0.5, ricevuto 9');
    expect(cli('nope').code).toBe(1);
  });

  it('runs as a real process, with the same bytes as in-process', () => {
    const out = execFileSync('node_modules/.bin/tsx', ['forge/cli.ts', 'list'], { encoding: 'utf8' });
    expect(out).toContain('planet@1');
    expect(() => execFileSync('node_modules/.bin/tsx', ['forge/cli.ts', 'render'], { stdio: 'pipe' })).toThrow();
    for (const [file, argv] of [
      ['proc.png', ['render', 'testdisc', '--seed', '12', '--size', '40']],
      ['proc.gif', ['anim', 'testdisc', '--frames', '3', '--bg']],
    ] as const) {
      execFileSync('node_modules/.bin/tsx', ['forge/cli.ts', ...argv, '-o', `${DIR}/tsx-${file}`], { stdio: 'pipe' });
      expect(cli(...argv, '-o', `${DIR}/vitest-${file}`).code).toBe(0);
      expect(readFileSync(`${DIR}/tsx-${file}`).equals(readFileSync(`${DIR}/vitest-${file}`))).toBe(true);
    }
  });
});

describe('forge CLI on the universe', () => {
  it('maps the whole galaxy and a region', () => {
    const whole = cli('galaxy', '--galaxy', '1', '--scale', '1', '-o', `${DIR}/galaxy.png`);
    expect(whole.code).toBe(0);
    expect(whole.out).toMatch(/galassia 1: raggio \d+ settori, 3 bracci/);
    expect(png(`${DIR}/galaxy.png`).width).toBeGreaterThan(400);
    const region = cli('galaxy', '--center', '-12,40', '--radius', '2', '--cell', '6', '--scale', '1', '-o', `${DIR}/region.png`);
    expect(region.code).toBe(0);
    expect(region.out).toContain('settori -14..-10, 38..42');
    expect(png(`${DIR}/region.png`).width).toBe(30);
    expect(cli('galaxy', '--center', '1').err).toContain('--center vuole due interi "sx,sy"');
  });

  it('shows systems as PNG and GIF, and lists random ones with their addresses', () => {
    const list = cli('systems', '--count', '2', '--size', '64', '-o', `${DIR}/systems.png`);
    expect(list.code).toBe(0);
    const address = list.out.split('\n')[0].split(' ')[0];
    expect(address).toMatch(/^0\.-?[0-9a-z]+\.-?[0-9a-z]+\.[0-9a-z]+$/);
    const view = cli('system', `${address}.s0`, '--size', '96', '--tick', '100', '--scale', '1', '-o', `${DIR}/system.png`);
    expect(view.code).toBe(0);
    expect(view.out).toContain(`indirizzo ${address}`);
    expect(view.out).toContain('stella ');
    expect(png(`${DIR}/system.png`).width).toBe(96);
    const anim = cli('system', address, '--size', '64', '--frames', '2', '--step', '50', '--scale', '1', '-o', `${DIR}/system.gif`);
    expect(anim.code).toBe(0);
    expect(anim.out).toContain('tick 0..50 (passo 50)');
    expect(readFileSync(`${DIR}/system.gif`).subarray(0, 6).toString()).toBe('GIF89a');
    expect(cli('system', '0.1').err).toContain('il settore vuole due coordinate');
    expect(cli('system', '0.99999.0.0').err).toContain('ha 0 sistemi');
    expect(cli('system', '0.3.4').err).toContain("deve arrivare almeno al sistema");
  });

  it('takes a census of 10,000 systems, prints it and finds every value in range', () => {
    const r = cli('census', '--count', '10000', '--galaxy', '3');
    console.log(r.out);
    expect(r.out).toContain('censimento di 10000 sistemi della galassia 3');
    expect(r.out).not.toContain('FUORI');
    expect(r.code).toBe(0);
  });
});
