import type { Command } from '../common';
import { chunks, scene } from './compose';
import { anim, params, render, sheet, sizes } from './generate';
import { golden, lint, list } from './inspect';
import { swatches, zoom } from './tools';
import { census, galaxy, system, systems } from './universe';
import { view } from './view';

/** Every forge command, in the order the help lists them. */
export const COMMANDS: readonly Command[] = [render, sheet, params, sizes, anim, chunks, scene, galaxy, system, systems, census, view, lint, golden, list, swatches, zoom];
