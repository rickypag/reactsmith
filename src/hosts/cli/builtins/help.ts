import { commandHelp, generalHelp, groupHelp } from '../help.js';
import { resolveCommand } from '../resolve.js';
import type { Builtin } from './types.js';

export const helpBuiltin: Builtin = {
  name: 'help',
  description: 'Show the help, or the help of a command (also -h, --help)',
  args: [{ name: 'command', description: 'A command or group, e.g. "init" or "feature create"', variadic: true }],
  options: {},

  run({ io, json, args, entries }) {
    if (json) {
      const commands = entries.map(({ name, description, args: commandArgs = [], options }) => ({
        name,
        description,
        args: commandArgs,
        options,
      }));
      io.log(JSON.stringify({ commands }, null, 2));
      return 0;
    }

    if (!args.command) {
      io.log(generalHelp(entries));
      return 0;
    }
    const resolution = resolveCommand(args.command.split(' '), entries);
    if (resolution.kind === 'entry' && resolution.rest.length === 0) {
      io.log(commandHelp(resolution.entry));
      return 0;
    }
    if (resolution.kind === 'group') {
      io.log(groupHelp(resolution.group, resolution.members));
      return 0;
    }
    io.error(`Unknown command "${args.command}".\n\n${generalHelp(entries)}`);
    return 2;
  },
};
