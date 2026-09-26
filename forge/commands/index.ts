import type { Command } from '../common';
import { anim, params, render, sheet, sizes } from './generate';
import { golden, lint, list } from './inspect';
import { swatches, zoom } from './tools';

/** Every forge command, in the order the help lists them. */
export const COMMANDS: readonly Command[] = [render, sheet, params, sizes, anim, lint, golden, list, swatches, zoom];
