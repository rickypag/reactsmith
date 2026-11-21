import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { checkUnused } from '../../unused.js';

/**
 * Unused: components nothing renders and styles nothing uses. Warnings: removing them is the dev's call. Not this
 * rule's: features nothing imports (features).
 */
export async function checkUnusedCode(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return checkUnused(root, config);
}
