import { COMMANDS, helpText } from './help';

function main(argv: readonly string[]): number {
  const [name] = argv;

  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    console.log(helpText());
    return 0;
  }

  const command = COMMANDS.find((c) => c.name === name);
  if (command === undefined) {
    console.error(`forge: comando sconosciuto "${name}"\n`);
    console.error(helpText());
    return 1;
  }

  console.error(`forge ${command.name}: non ancora implementato`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
