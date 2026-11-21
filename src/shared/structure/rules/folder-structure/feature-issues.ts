import path from 'node:path';
import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { matchesNaming, toNaming } from '../../../naming.js';
import { unknownFolders } from './unknown-folders.js';

/** The feature folders: each named after featureNaming, holding only the folders of the tree. */
export async function featureIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { path: featuresRel, feature: place } = config.tree.features;
  const issues: Issue[] = [];

  for (const entry of (await readDir(path.join(root, featuresRel))) ?? []) {
    if (!entry.isDirectory()) continue;
    const entryRel = `${featuresRel}/${entry.name}`;

    if (!matchesNaming(entry.name, config.featureNaming)) {
      issues.push({
        severity: 'error',
        code: 'feature-naming',
        path: entryRel,
        message: `Feature "${entry.name}" does not follow ${config.featureNaming}.`,
        hint: `Rename it to "${toNaming(entry.name, config.featureNaming)}", or change "featureNaming" in ${CONFIG_FILE}.`,
      });
    }

    issues.push(...unknownFolders(config, 'featureFolders', place, entryRel, (await readDir(path.join(root, entryRel))) ?? [], entry.name));
  }
  return issues;
}
