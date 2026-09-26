// Every registered generator. New generators are added here.

import { asteroid } from './asteroid/index';
import { background } from './background/index';
import { planet } from './planet/index';
import { Registry } from './registry';
import { star } from './star/index';
import { testdisc } from './testdisc';

export const registry = new Registry([asteroid, background, planet, star, testdisc]);
