import { readPackageVersion } from '../../../shared/package.js';
import type { Builtin } from './types.js';

export const versionBuiltin: Builtin = {
  name: 'version',
  description: 'Show the version (also -v, --version)',
  options: {},

  run({ io, json }) {
    const version = readPackageVersion();
    io.log(json ? JSON.stringify({ version }) : version);
    return 0;
  },
};
