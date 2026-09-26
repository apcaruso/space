import { describe, expect, it } from 'vitest';
import { COMMANDS, helpText } from './help';

describe('forge help', () => {
  it('lists every command', () => {
    const text = helpText();
    for (const command of COMMANDS) {
      expect(text).toContain(command.usage);
    }
  });

  it('has unique command names', () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
