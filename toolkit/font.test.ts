import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../core/buffer';
import { CHARSET, drawText, textWidth } from './font';
import { rows } from './grid';

function render(text: string): string[] {
  const buf = new IndexedBuffer(Math.max(1, textWidth(text)), 5);
  drawText(buf, text, 0, 0, 1);
  return rows(buf);
}

describe('font', () => {
  it('covers digits, capitals and basic punctuation', () => {
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ .,:;-+=_/()!?\'#%*<>') expect(CHARSET).toContain(ch);
  });

  it('draws glyphs on a 3x5 grid with one column of spacing', () => {
    expect(render('1')).toEqual(['.1.', '11.', '.1.', '.1.', '111']);
    expect(render('A-')).toEqual(['.1.....', '1.1....', '111.111', '1.1....', '1.1....']);
    expect(textWidth('')).toBe(0);
    expect(textWidth('AB')).toBe(7);
  });

  it('draws lowercase as uppercase and unknown characters as ?', () => {
    expect(render('m')).toEqual(render('M'));
    expect(render('é')).toEqual(render('?'));
  });

  it('gives every character a distinct glyph', () => {
    const seen = new Map<string, string>();
    for (const ch of CHARSET) {
      const key = render(ch).join('|');
      expect(seen.get(key), `${ch} looks like ${seen.get(key)}`).toBeUndefined();
      seen.set(key, ch);
    }
  });

  it('clips at the buffer edge', () => {
    const buf = new IndexedBuffer(2, 2);
    drawText(buf, 'W', -1, -1, 1);
    expect(rows(buf)).toEqual(['.1', '11']);
  });
});
