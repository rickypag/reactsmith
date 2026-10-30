import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/commands/index.js';
import { SHARED_OPTIONS } from '../../src/shared/options.js';

/** Options that share a name with a shared option but mean something else: each one is a decision still to make. */
const EXCEPTIONS = ['component update --name'];

describe('shared options', () => {
  it('mean the same thing in every command: a command uses the shared definition, never its own', () => {
    const own: string[] = [];
    for (const command of COMMANDS) {
      for (const [name, spec] of Object.entries(command.options)) {
        const shared = SHARED_OPTIONS[name];
        if (shared && !shared.includes(spec)) own.push(`${command.name} --${name}`);
      }
    }
    expect(own).toEqual(EXCEPTIONS);
  });
});
