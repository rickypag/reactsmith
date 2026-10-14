import type { HelpEntry } from '../help.js';
import type { CommandIO } from '../io.js';

export interface BuiltinContext {
  io: CommandIO;
  json: boolean;
  args: Record<string, string | undefined>;
  /** Every command the CLI offers, built-ins included. */
  entries: HelpEntry[];
}

/**
 * A command that belongs to the CLI itself (help, version), not to ReactSmith.
 * Always available, whatever set of commands the CLI runs.
 */
export interface Builtin extends HelpEntry {
  run(context: BuiltinContext): number;
}
