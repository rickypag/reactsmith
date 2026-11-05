import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { APP_FILE_PATTERN } from '../../app-files.js';
import { misplacedFiles } from './misplaced-files.js';
import { folderList, placeFiles } from './place-files.js';
import { unitFolderIssues } from './unit-folder-issues.js';

/**
 * The app folder: its own files (the router, constants.ts, and the App files unless "appFiles" keeps them at the top
 * of srcDir), then its folders of views, layouts and components.
 */
export async function appIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { app, srcDir } = config.tree;
  if (!app) return [];
  const appFilesHere = config.appFiles !== 'root';
  const files = placeFiles(app);

  const rootIssues = await misplacedFiles(root, {
    folderRel: app.path,
    holds: `only folders and ${[...(appFilesHere ? ['the App files'] : []), ...files].join(', ')}`,
    allows: (fileName) => files.includes(fileName) || (appFilesHere && APP_FILE_PATTERN.test(fileName)),
    hint: (fileName) =>
      APP_FILE_PATTERN.test(fileName)
        ? `"appFiles" is "root" in ${CONFIG_FILE}: move it to ${srcDir}/${fileName}, or set "appFiles" to "app".`
        : `Move it into one of the app's folders: ${folderList(app)}.`,
  });
  return [...rootIssues, ...(await unitFolderIssues(root, app.path, app.folders))];
}
