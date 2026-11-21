import { checkAliasSetup } from '../../../alias/check.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';

/** Alias: the import alias of the config is set up in tsconfig and in the Vite config. */
export async function checkAlias(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return checkAliasSetup(root, config);
}
