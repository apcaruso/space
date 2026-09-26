// Every registered generator. New generators are added here.

import { Registry } from './registry';
import { testdisc } from './testdisc';

export const registry = new Registry([testdisc]);
