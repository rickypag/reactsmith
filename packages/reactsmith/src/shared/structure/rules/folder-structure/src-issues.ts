import type { Dirent } from 'node:fs';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { unknownFolders } from './unknown-folders.js';

/** The top of srcDir: only the folders of the tree. */
export function srcIssues(config: ResolvedConfig, entries: Dirent[]): Issue[] {
  const { tree } = config;
  return unknownFolders(config, 'folders', tree.src, tree.srcDir, entries);
}
