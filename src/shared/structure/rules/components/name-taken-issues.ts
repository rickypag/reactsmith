import { projectComponents } from '../../../components/registry.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';

/**
 * One name, one component: what the project imports by name is never ambiguous. Counts the components and the
 * layouts, which are imported by name too.
 */
export async function nameTakenIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const byName = new Map<string, string[]>();
  for (const { name, folderRel } of await projectComponents(root, config)) byName.set(name, [...(byName.get(name) ?? []), folderRel]);
  return [...byName]
    .filter(([, folderRels]) => folderRels.length > 1)
    .map(([name, folderRels]) => ({
      severity: 'error',
      code: 'component-name-taken',
      path: folderRels[1]!,
      message: `"${name}" is the name of ${folderRels.length} components: ${folderRels.join(', ')}.`,
      hint: 'Component names are unique in the project: rename all but one, e.g. with a name that says where it is used.',
    }));
}
