import path from 'node:path';
import { CONFIG_FILE, TOOL_NAME } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { APP_FILE_PATTERN } from '../../app-files.js';

/**
 * App files: App.tsx, App.css… are where "appFiles" says, in the app folder or at the top of srcDir. Reports them at
 * the top of srcDir when they belong in the app folder, or when the config doesn't say yet.
 */
export async function checkAppFiles(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { srcDir, folders } = config;
  const entries = (await readDir(path.join(root, srcDir))) ?? [];
  const appFiles = entries.filter((entry) => entry.isFile() && APP_FILE_PATTERN.test(entry.name)).map((entry) => entry.name);
  if (appFiles.length === 0) return [];
  const fileList = appFiles.join(', ');

  if (config.appFiles === 'app') {
    return [{
      severity: 'error',
      code: 'app-files-location',
      path: srcDir,
      message: `${fileList} must be in ${srcDir}/${folders.app}/, not in ${srcDir}/.`,
      hint: `Run "${TOOL_NAME} init" to move them and update their imports, or set "appFiles": "root" in ${CONFIG_FILE}.`,
    }];
  }
  if (config.appFiles === undefined) {
    return [{
      severity: 'warning',
      code: 'app-files-undecided',
      path: srcDir,
      message: `${fileList} ${appFiles.length === 1 ? 'is' : 'are'} in ${srcDir}/ and "appFiles" is not set.`,
      hint: `Run "${TOOL_NAME} init" to choose, or set "appFiles" in ${CONFIG_FILE} to "app" (move them to ${srcDir}/${folders.app ?? 'app'}/) or "root" (keep them where they are).`,
    }];
  }
  return [];
}
