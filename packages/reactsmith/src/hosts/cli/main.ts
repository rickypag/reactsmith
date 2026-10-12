import path from 'node:path';
import type { Command } from '../../core/command.js';
import { helpBuiltin } from './builtins/help.js';
import type { Builtin } from './builtins/types.js';
import { versionBuiltin } from './builtins/version.js';
import { commandHelp, generalHelp, type HelpEntry } from './help.js';
import type { CommandIO } from './io.js';
import { parseCommandArgs, UsageError } from './parse.js';
import { renderResult } from './render.js';

export interface CliOptions {
  argv: string[];
  commands: Command[];
  createIO: (json: boolean) => CommandIO;
}

const BUILTINS: Builtin[] = [helpBuiltin, versionBuiltin];

type Entry = Command | Builtin;

function isBuiltin(entry: Entry): entry is Builtin {
  return (BUILTINS as Entry[]).includes(entry);
}

const ALIASES: Record<string, string> = {
  '-h': 'help',
  '--help': 'help',
  '-v': 'version',
  '--version': 'version',
};

function assertUniqueNames(entries: HelpEntry[]): void {
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (seen.has(name)) throw new Error(`Two commands are named "${name}". "help" and "version" are reserved.`);
    seen.add(name);
  }
}

export async function runCli({ argv, commands, createIO }: CliOptions): Promise<number> {
  const entries: Entry[] = [...commands, ...BUILTINS];
  assertUniqueNames(entries);
  const [first, ...rest] = argv;

  if (!first) {
    createIO(false).error(generalHelp(entries));
    return 2;
  }

  const name = ALIASES[first] ?? first;
  const target = entries.find((entry) => entry.name === name);
  if (!target) {
    createIO(false).error(`Unknown command "${name}".\n\n${generalHelp(entries)}`);
    return 2;
  }

  let args;
  try {
    args = parseCommandArgs(target, rest);
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

  if (isBuiltin(target)) return target.run({ io, json: args.json, entries });

  const result = await target.run({
    cwd: path.resolve(args.cwd ?? process.cwd()),
    options: args.options as never,
    confirm: io.confirm,
  });
  return renderResult(io, result, args.json);
}
