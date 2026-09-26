// Test helpers: small buffers written as rows of characters. '.' is transparent, '1'-'9' are
// palette indices.

import { IndexedBuffer } from '../core/buffer';

export function grid(rows: readonly string[]): IndexedBuffer {
  const buf = new IndexedBuffer(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) buf.set(x, y, row[x] === '.' ? 0 : Number(row[x]));
  });
  return buf;
}

export function rows(buf: IndexedBuffer): string[] {
  const out: string[] = [];
  for (let y = 0; y < buf.h; y++) {
    let row = '';
    for (let x = 0; x < buf.w; x++) {
      const v = buf.get(x, y);
      row += v === 0 ? '.' : String(v);
    }
    out.push(row);
  }
  return out;
}
