import { describeOptions } from './args';
import { COMMANDS } from './commands/index';
import type { Command } from './common';

/** Overview of every command. */
export function helpText(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return [
    'forge: CLI di spatialengine per generatori, preview e golden',
    '',
    'Uso: npm run forge -- <comando> [opzioni]    (help <comando> per le opzioni)',
    '',
    'Comandi:',
    ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    'Le immagini finiscono sempre in out/ (ignorata da git), a scala intera senza interpolazione.',
  ].join('\n');
}

/** Usage and options of one command. */
export function commandHelp(command: Command): string {
  const options = describeOptions(command.options);
  return [`npm run forge -- ${command.usage}`, '', command.summary, ...(options.length > 0 ? ['', 'Opzioni:', ...options] : [])].join('\n');
}
