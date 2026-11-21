import type { Command } from '../../../core/command.js';
import type { HelpEntry } from '../help.js';
import type { CommandIO } from '../io.js';

export interface BuiltinContext {
  io: CommandIO;
  json: boolean;
  args: Record<string, string | undefined>;
  /** The built-in's own options, parsed. */
  options: Record<string, unknown>;
  /** Every command the CLI offers, built-ins included. */
  entries: HelpEntry[];
  /** The ReactSmith commands alone, without the built-ins: what a batch can run. */
  commands: Command[];
  /** Absolute project root. */
  cwd: string;
  /** Everything the input stream gives, until it ends. */
  readStdin: () => Promise<string>;
}

/**
 * A command that belongs to the CLI itself (help, version, batch), not to ReactSmith.
 * Always available, whatever set of commands the CLI runs.
 */
export interface Builtin extends HelpEntry {
  run(context: BuiltinContext): number | Promise<number>;
}
