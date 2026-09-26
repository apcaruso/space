import { describe, expect, it } from 'vitest';
import { fillHoles, fixCorners, removeOrphans } from './cleanup';
import { grid, rows } from './grid';

describe('removeOrphans', () => {
  it('removes isolated pixels and absorbs lone pixels into their surroundings', () => {
    expect(rows(removeOrphans(grid(['...', '.3.', '...'])))).toEqual(['...', '...', '...']);
    expect(rows(removeOrphans(grid(['22222', '22322', '22222'])))).toEqual(['22222', '22222', '22222']);
  });

  it('keeps pixels with a same-coloured neighbour, diagonals included', () => {
    const checker = ['2323', '3232', '2323'];
    expect(rows(removeOrphans(grid(checker)))).toEqual(checker);
    const line = ['3....', '.3...', '..3..'];
    expect(rows(removeOrphans(grid(line)))).toEqual(line);
  });

  it('lets opaque colours win ties against transparency', () => {
    expect(rows(removeOrphans(grid(['.2.', '232', '.2.'])))).toEqual(['.2.', '222', '.2.']);
  });
});

describe('fillHoles', () => {
  it('fills 1 px holes with the most common neighbour', () => {
    expect(rows(fillHoles(grid(['222', '2.2', '222'])))).toEqual(['222', '222', '222']);
    expect(rows(fillHoles(grid(['332', '3.2', '332'])))).toEqual(['332', '332', '332']);
  });

  it('leaves larger holes and gaps at the edge', () => {
    const wide = ['2222', '2..2', '2222'];
    expect(rows(fillHoles(grid(wide)))).toEqual(wide);
    const edge = ['.2', '22'];
    expect(rows(fillHoles(grid(edge)))).toEqual(edge);
  });
});

describe('fixCorners', () => {
  it('turns a doubled staircase into a clean diagonal', () => {
    const stairs = ['11....', '.11...', '..11..', '...11.'];
    expect(rows(fixCorners(grid(stairs)))).toEqual(['1.....', '.1....', '..1...', '...11.']);
  });

  it('keeps true corners, blocks and straight lines', () => {
    for (const shape of [['1111', '1..1', '1111'], ['11', '11'], ['.....', '11111', '.....'], ['1..', '1..', '111']]) {
      expect(rows(fixCorners(grid(shape)))).toEqual(shape);
    }
  });

  it('fills a removed corner with the surrounding colour', () => {
    const stairs = ['222222', '112222', '211222', '221122'];
    expect(rows(fixCorners(grid(stairs), [1]))).toEqual(['222222', '122222', '212222', '221122']);
  });

  it('treats several indices as one line when asked', () => {
    const mixed = ['14....', '.41...', '..14..'];
    expect(rows(fixCorners(grid(mixed)))).toEqual(mixed);
    expect(rows(fixCorners(grid(mixed), [1, 4]))).toEqual(['1.....', '.4....', '..14..']);
  });
});
