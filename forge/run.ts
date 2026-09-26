import { RecipeError } from '../gen/schema';
import { parseArgs, UsageError } from './args';
import { COMMANDS } from './commands/index';
import type { Io } from './common';
import { commandHelp, helpText } from './help';

const HELP = new Set(['help', '--help', '-h']);

/** Runs one forge command line; returns the exit code. Errors meant for people are printed, bugs are thrown. */
export function runCli(argv: readonly string[], io: Io): number {
  const [name, ...rest] = argv;
  if (name === undefined || HELP.has(name)) {
    const topic = COMMANDS.find((c) => c.name === rest[0]);
    io.out(topic === undefined ? helpText() : commandHelp(topic));
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (command === undefined) {
    io.err(`forge: comando sconosciuto "${name}"\n`);
    io.err(helpText());
    return 1;
  }
  if (rest.some((a) => HELP.has(a) && a !== 'help')) {
    io.out(commandHelp(command));
    return 0;
  }
  try {
    return command.run(parseArgs(rest, command.options), io);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`forge ${name}: ${e.message}`);
      io.err(`uso: npm run forge -- ${command.usage}`);
      return 1;
    }
    if (e instanceof RecipeError || (e instanceof Error && (e.name === 'Error' || e.name === 'RangeError'))) {
      io.err(`forge ${name}: ${e.message}`);
      return 1;
    }
    throw e;
  }
}
