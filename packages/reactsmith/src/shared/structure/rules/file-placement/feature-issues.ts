import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { misplacedFiles } from './misplaced-files.js';
import { folderList, placeFiles } from './place-files.js';
import { unitFolderIssues } from './unit-folder-issues.js';

/**
 * The features folder, which holds only feature folders, then each feature: its own files (public API, routes file,
 * constants.ts), then its folders of views, layouts and components.
 */
export async function featureIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { path: featuresRel, feature: place } = config.tree.features;
  const issues = await misplacedFiles(root, {
    folderRel: featuresRel,
    holds: 'only feature folders',
    allows: () => false,
    hint: () => 'Move it into a feature folder or into a shared folder.',
  });

  const files = placeFiles(place);
  for (const entry of (await readDir(path.join(root, featuresRel))) ?? []) {
    if (!entry.isDirectory()) continue;
    const featureRel = `${featuresRel}/${entry.name}`;
    issues.push(
      ...(await misplacedFiles(root, {
        folderRel: featureRel,
        holds: `only folders and ${files.join(', ')}`,
        allows: (fileName) => files.includes(fileName),
        hint: () => `Move it into one of the feature's folders: ${folderList(place)}.`,
      })),
      ...(await unitFolderIssues(root, featureRel, place.folders)),
    );
  }
  return issues;
}
