import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { unknownFolders } from './unknown-folders.js';

/** The app folder: only the folders of the tree. */
export async function appIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { app } = config.tree;
  if (!app) return [];
  return unknownFolders(config, 'appFolders', app, app.path, (await readDir(path.join(root, app.path))) ?? []);
}
