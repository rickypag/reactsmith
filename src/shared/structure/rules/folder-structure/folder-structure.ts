import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { srcMissingIssue } from '../../app-files.js';
import { appIssues } from './app-issues.js';
import { featureIssues } from './feature-issues.js';
import { readDir } from '../../../files.js';
import { sharedComponentsIssues } from './shared-components-issues.js';
import { srcIssues } from './src-issues.js';

/**
 * Folder structure: the folders of the project are the ones the tree allows, where it allows them. Checks the top of
 * srcDir, the shared components (one folder per type), the app folder and each feature folder, in that order. Files are not this rule's: where they may sit is the
 * file-placement rule's, which ones must exist the rules of what they are (app files, routing…), and what is inside
 * each view, component and layout folder the rules of those.
 */
export async function checkFolderStructure(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const srcEntries = await readDir(path.join(root, config.tree.srcDir));
  if (!srcEntries) return [srcMissingIssue(config)];

  return [
    ...srcIssues(config, srcEntries),
    ...(await sharedComponentsIssues(root, config)),
    ...(await appIssues(root, config)),
    ...(await featureIssues(root, config)),
  ];
}
