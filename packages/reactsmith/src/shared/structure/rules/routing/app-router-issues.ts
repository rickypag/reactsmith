import path from 'node:path';
import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { exists } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import type { TreeFileRole } from '../../../tree/types.js';

/** The issue for each file of the app folder that the tree requires and the project lacks. */
const MISSING: Partial<Record<TreeFileRole, (appRel: string, fileRel: string) => Issue>> = {
  router: (appRel, fileRel) => ({
    severity: 'warning',
    code: 'app-router-missing',
    path: appRel,
    message: `A router is configured, but ${appRel}/${fileRel} does not exist.`,
    hint: `Create ${appRel}/${fileRel} with the app's routes (mounting each feature's routes), or set "appRouter" in ${CONFIG_FILE}.`,
  }),
};

/** The app folder's files that the tree requires when the project has a router: its router file. */
export async function appRouterIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { app } = config.tree;
  if (!app || !config.router) return [];
  const issues: Issue[] = [];
  for (const file of app.files) {
    const missing = MISSING[file.role];
    if (!file.requiredWithRouter || !missing) continue;
    if (!(await exists(path.join(root, app.path, file.path)))) issues.push(missing(app.path, file.path));
  }
  return issues;
}
