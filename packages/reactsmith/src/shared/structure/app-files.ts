import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { planMove } from '../imports/move.js';
import { IssueError, type Issue } from '../issues.js';

/** Files that belong to the app root: App.tsx, App.css, App.test.tsx, ... */
export const APP_FILE_PATTERN = /^App\./;

export function srcMissingIssue(config: ResolvedConfig): Issue {
  return {
    severity: 'error',
    code: 'src-missing',
    path: config.srcDir,
    message: `Source folder "${config.srcDir}" does not exist.`,
    hint: `Run the command from the project root, or set "srcDir" in ${CONFIG_FILE}.`,
  };
}

/** Names of the App.* files directly in srcDir, sorted. Throws if srcDir does not exist. */
export async function findRootAppFiles(root: string, config: ResolvedConfig): Promise<string[]> {
  const entries = await readdir(path.join(root, config.srcDir), { withFileTypes: true }).catch(() => {
    throw new IssueError(srcMissingIssue(config));
  });
  return entries
    .filter((entry) => entry.isFile() && APP_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Plans moving the App.* files from srcDir into the app folder, rewriting their imports. */
export async function planAppFilesMove(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  if (!config.folders.app) {
    throw new IssueError({
      severity: 'error',
      code: 'config-invalid',
      path: CONFIG_FILE,
      message: 'Cannot move the App files: "folders.app" is disabled.',
      hint: 'Enable "folders.app" or keep the App files in the source root ("appFiles": "root").',
    });
  }

  const names = await findRootAppFiles(changes.root, config);
  if (names.length === 0) return;
  const srcDir = changes.resolve(config.srcDir);
  const appDir = path.join(srcDir, config.folders.app);
  await planMove(
    changes,
    { srcDir, alias: config.alias },
    names.map((name) => ({ from: path.join(srcDir, name), to: path.join(appDir, name) })),
  );
}
