import { generalHelp } from '../help.js';
import type { Builtin } from './types.js';

export const helpBuiltin: Builtin = {
  name: 'help',
  description: 'Show this help (also -h, --help)',
  options: {},

  run({ io, json, entries }) {
    if (json) {
      const commands = entries.map(({ name, description, options }) => ({ name, description, options }));
      io.log(JSON.stringify({ commands }, null, 2));
    } else {
      io.log(generalHelp(entries));
    }
    return 0;
  },
};
