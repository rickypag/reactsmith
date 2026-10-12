import type { HelpEntry } from '../help.js';
import type { CommandIO } from '../io.js';

export interface Builtin extends HelpEntry {
  run(context: { io: CommandIO; json: boolean; entries: HelpEntry[] }): number;
}
