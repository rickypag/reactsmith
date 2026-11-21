import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { routeFolderIssues } from './route-folder-issues.js';

/**
 * Next's app folder: in a Next.js app, src/app is Next's, so ReactSmith leaves its routing alone and only checks
 * that it holds Next's own files (pages, layouts, routes, metadata files, CSS) in route folders, and no code of the
 * app, which belongs in features and shared folders where the other rules see it. What the pages import is checked
 * by the imports and unused rules, like any file.
 */
export async function checkNextApp(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.tree.next) return [];
  return routeFolderIssues(root, config, config.tree.next.path);
}
