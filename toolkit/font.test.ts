import { describe, expect, it } from 'vitest';
import { IndexedBuffer } from '../core/buffer';
import { charset, CHARSET, drawText, fitText, LARGE, SMALL, SMALL_CAPS, textWidth, type Font } from './font';
import { rows } from './grid';

function render(text: string): string[] {
  const buf = new IndexedBuffer(Math.max(1, textWidth(text)), 5);
  drawText(buf, text, 0, 0, 1);
  return rows(buf);
}

/** Whole glyph box, accents above and descenders below included. */
function renderTall(text: string, font: Font): string {
  const buf = new IndexedBuffer(Math.max(1, textWidth(text, font)), font.lineHeight + 3);
  drawText(buf, text, 0, 3, 1, font);
  return rows(buf).join('|');
}

describe('font', () => {
  it('covers digits, capitals, lowercase, accents and punctuation', () => {
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ .,:;-+=_/()!?\'#%*<>@') expect(CHARSET).toContain(ch);
    for (const font of [SMALL, LARGE]) {
      for (const ch of 'abcdefghijklmnopqrstuvwxyzàèéìòùÀÈÉÌÒÙ·×°›') expect(charset(font), `${font.name} ${ch}`).toContain(ch);
      expect(charset(font)).toBe(charset(font === SMALL ? SMALL : LARGE));
    }
    // Both fonts draw the same characters.
    expect([...charset(SMALL)].sort()).toEqual([...charset(LARGE)].sort());
  });

  it('draws glyphs on a 3x5 grid with one column of spacing', () => {
    expect(render('1')).toEqual(['.1.', '11.', '.1.', '.1.', '111']);
    expect(render('A-')).toEqual(['.1.....', '1.1....', '111.111', '1.1....', '1.1....']);
    expect(textWidth('')).toBe(0);
    expect(textWidth('AB')).toBe(7);
    expect(textWidth('AB', LARGE)).toBe(11);
  });

  it('draws lowercase as capitals in the label font and unknown characters as ?', () => {
    expect(render('m')).toEqual(render('M'));
    expect(render('ß')).toEqual(render('?'));
    expect(renderTall('é', SMALL_CAPS)).toBe(renderTall('É', SMALL_CAPS));
    expect(renderTall('m', SMALL)).not.toBe(renderTall('M', SMALL));
  });

  it('puts accents above the letter and descenders below the baseline', () => {
    const e = renderTall('e', SMALL).split('|');
    const eGrave = renderTall('è', SMALL).split('|');
    expect(eGrave.slice(4)).toEqual(e.slice(4));
    expect(eGrave[3]).toBe('1..');
    expect(renderTall('È', LARGE).split('|').slice(0, 3)).toEqual(['.....', '.1...', '..1..']);
    expect(renderTall('g', SMALL).split('|')[8]).toBe('11.');
  });

  it('gives every character a distinct glyph', () => {
    for (const font of [SMALL, LARGE, SMALL_CAPS]) {
      const seen = new Map<string, string>();
      for (const ch of font === SMALL_CAPS ? CHARSET : charset(font)) {
        const key = renderTall(ch, font);
        expect(seen.get(key), `${font.name}: ${ch} looks like ${seen.get(key)}`).toBeUndefined();
        seen.set(key, ch);
      }
    }
  });

  it('clips at the buffer edge and shortens text to a width', () => {
    const buf = new IndexedBuffer(2, 2);
    drawText(buf, 'W', -1, -1, 1);
    expect(rows(buf)).toEqual(['.1', '11']);
    expect(fitText('Galassia', 100)).toBe('Galassia');
    const cut = fitText('Galassia di Andromeda', 30);
    expect(cut.endsWith('..')).toBe(true);
    expect(textWidth(cut, SMALL)).toBeLessThanOrEqual(30);
  });
});
