import path from 'node:path';
import type { Command } from '../../core/command.js';
import { helpBuiltin } from './builtins/help.js';
import type { Builtin } from './builtins/types.js';
import { versionBuiltin } from './builtins/version.js';
import { commandHelp, generalHelp, groupHelp, type HelpEntry } from './help.js';
import type { CommandIO } from './io.js';
import { parseCommandArgs, UsageError } from './parse.js';
import { renderResult } from './render.js';
import { resolveCommand } from './resolve.js';

export interface CliOptions {
  argv: string[];
  /** The commands to offer. The built-in help and version are always added. */
  commands: Command[];
  /** Creates the IO for a run; `json` disables prompts. */
  createIO: (json: boolean) => CommandIO;
}

const BUILTINS: Builtin[] = [helpBuiltin, versionBuiltin];

type Entry = Command | Builtin;

function isBuiltin(entry: Entry): entry is Builtin {
  return (BUILTINS as Entry[]).includes(entry);
}

/** Throws if two entries share a name: that is a programming error, not a user error. */
function assertUniqueNames(entries: HelpEntry[]): void {
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (seen.has(name)) throw new Error(`Two commands are named "${name}". "help" and "version" are reserved.`);
    seen.add(name);
  }
}

/** The CLI host: finds the command, parses its arguments, runs it and renders the result. Returns the exit code. */
export async function runCli({ argv, commands, createIO }: CliOptions): Promise<number> {
  const entries: Entry[] = [...commands, ...BUILTINS];
  assertUniqueNames(entries);

  if (argv.length === 0) {
    createIO(false).error(generalHelp(entries));
    return 2;
  }

  const resolution = resolveCommand(argv, entries);
  if (resolution.kind === 'unknown') {
    createIO(false).error(`Unknown command "${resolution.name}".\n\n${generalHelp(entries)}`);
    return 2;
  }
  if (resolution.kind === 'group') {
    // "reactsmith feature --help" shows the group; "reactsmith feature" alone is incomplete.
    const asked = resolution.rest.includes('--help') || resolution.rest.includes('-h');
    const io = createIO(false);
    if (asked) io.log(groupHelp(resolution.group, resolution.members));
    else io.error(groupHelp(resolution.group, resolution.members));
    return asked ? 0 : 2;
  }

  const target = resolution.entry;
  let args;
  try {
    args = parseCommandArgs(target, resolution.rest);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    createIO(false).error(`${error.message}\n\n${commandHelp(target)}`);
    return 2;
  }

  const io = createIO(args.json);
  if (args.help) {
    io.log(commandHelp(target));
    return 0;
  }

  if (isBuiltin(target)) return target.run({ io, json: args.json, args: args.args, entries });

  const result = await target.run({
    cwd: path.resolve(args.cwd ?? process.cwd()),
    args: args.args as never,
    options: args.options as never,
    confirm: io.confirm,
    ask: io.ask,
  });
  return renderResult(io, result, args.json);
}
