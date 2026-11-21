import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { exists, readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import type { TreeFileRole } from '../../../tree/types.js';

/** The issue for each file of a feature that the tree requires and the feature lacks. */
const MISSING: Partial<Record<TreeFileRole, (featureRel: string, feature: string, fileRel: string) => Issue>> = {
  routes: (featureRel, feature, fileRel) => ({
    severity: 'warning',
    code: 'feature-routes-missing',
    path: featureRel,
    message: `Feature "${feature}" has no routes file ${fileRel}.`,
    hint: `Add ${featureRel}/${fileRel} exporting the feature's routes. Features without pages can ignore this warning.`,
  }),
};

/** Each feature's files that the tree requires when the project has a router: its routes file. */
export async function featureRoutesIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.router) return [];
  const { path: featuresRel, feature: place } = config.tree.features;
  const issues: Issue[] = [];
  for (const entry of (await readDir(path.join(root, featuresRel))) ?? []) {
    if (!entry.isDirectory()) continue;
    const featureRel = `${featuresRel}/${entry.name}`;
    for (const file of place.files) {
      const missing = MISSING[file.role];
      if (!file.requiredWithRouter || !missing) continue;
      if (!(await exists(path.join(root, featureRel, file.path)))) issues.push(missing(featureRel, entry.name, file.path));
    }
  }
  return issues;
}
