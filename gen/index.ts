// Every registered generator. New generators are added here.

import { planet } from './planet/index';
import { Registry } from './registry';
import { testdisc } from './testdisc';

export const registry = new Registry([planet, testdisc]);
