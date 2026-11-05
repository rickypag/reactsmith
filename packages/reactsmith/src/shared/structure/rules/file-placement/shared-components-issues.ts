import path from 'node:path';
import { componentTypes } from '../../../components/scope.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { baseName, misplacedFiles } from './misplaced-files.js';

/**
 * The shared components: only type folders at the top, and in each type folder only component folders and the type's
 * barrel. Folders that are not a type are the folder-structure rule's (unknown-component-type).
 */
export async function sharedComponentsIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const folder = config.tree.src.folders.find((candidate) => candidate.holds === 'components');
  if (!folder) return [];
  const sharedRel = `${config.tree.srcDir}/${folder.name}`;
  const issues = await misplacedFiles(root, {
    folderRel: sharedRel,
    holds: 'only the folders of the component types',
    allows: () => false,
    hint: (fileName) => `Move it into the folder of its type: ${sharedRel}/<type>/${baseName(fileName)}/${fileName}.`,
  });

  const types = componentTypes(config);
  for (const entry of (await readDir(path.join(root, sharedRel))) ?? []) {
    if (!entry.isDirectory() || !types.includes(entry.name)) continue;
    const typeRel = `${sharedRel}/${entry.name}`;
    issues.push(
      ...(await misplacedFiles(root, {
        folderRel: typeRel,
        holds: 'only component folders and its index.ts',
        allows: (fileName) => fileName === 'index.ts',
        hint: (fileName) =>
          `Move it to ${typeRel}/${baseName(fileName)}/${fileName}, add an index.ts exporting it, and export it from ${typeRel}/index.ts.`,
      })),
    );
  }
  return issues;
}
