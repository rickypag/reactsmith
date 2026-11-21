import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { fileIssues } from './file-issues.js';
import { keyIssues } from './key-issues.js';
import { textIssues } from './text-issues.js';

/**
 * Messages: in a translated app ("i18n" in the config), the message files are valid and the default language has
 * its file; every key the code shows has its text in the default language, the other languages have every key, and
 * every key is shown; the components, views and layouts show messages, not literal texts. Not this rule's: setting up
 * the library, its routing and its provider, which are the dev's.
 */
export async function checkMessages(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.i18n) return [];
  const { issues, files } = await fileIssues(root, config.i18n);
  return [...issues, ...(await keyIssues(root, config, files)), ...(await textIssues(root, config))];
}
