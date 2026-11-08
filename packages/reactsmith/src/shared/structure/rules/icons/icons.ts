import type { ResolvedConfig } from '../../../config/types.js';
import { checkIconLibraries } from '../../../icons/library.js';
import type { Issue } from '../../../issues.js';

/**
 * Icons: when the config has an icon library, the project imports icons only from it, and with the Icon suffix.
 */
export async function checkIcons(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  await checkIconLibraries(root, config, issues);
  return issues;
}
