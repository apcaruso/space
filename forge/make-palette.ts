// Regenerates style/palette.json from style/ramps.json: `npm run palette`.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildPalette, formatPalette, type PaletteParams } from './palette';

const PARAMS = 'style/ramps.json';
const OUTPUT = 'style/palette.json';

const params = JSON.parse(readFileSync(PARAMS, 'utf8')) as PaletteParams;
const { data, report } = buildPalette(params);
writeFileSync(OUTPUT, formatPalette(data));
console.log(report.join('\n'));
console.log(`\nwritten ${OUTPUT}`);
