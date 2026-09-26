import { describe, expect, it } from 'vitest';
import { COMMANDS } from './commands/index';
import { commandHelp, helpText } from './help';

describe('forge help', () => {
  it('lists every command', () => {
    const text = helpText();
    for (const command of COMMANDS) expect(text).toContain(command.name);
  });

  it('has unique command names and documents every option', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of COMMANDS) {
      const text = commandHelp(command);
      for (const option of Object.keys(command.options)) expect(text).toContain(`--${option}`);
    }
  });
});
