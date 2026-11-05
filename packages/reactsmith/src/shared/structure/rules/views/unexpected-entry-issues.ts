import type { Dirent } from 'node:fs';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER } from '../../api.js';
import { styleFileOf, unitEntryIssues } from '../unit-entries.js';

/** The view's data loader, which the routes run before rendering it ("view create --loader"). */
const LOADER_FILE = 'loader.ts';

const ELSEWHERE = "Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.";

/**
 * The view folder holds only the view file, its style file, its loader, index.ts, and the folders api/, tests/ and
 * stories/.
 */
export function unexpectedEntryIssues(config: ResolvedConfig, unit: TreeUnit, entries: Dirent[]): Issue[] {
  const viewFile = `${unit.name}.tsx`;
  return unitEntryIssues(config, unit, entries, {
    code: 'view-unexpected-file',
    files: [viewFile, styleFileOf(config, viewFile), LOADER_FILE, 'index.ts'],
    folders: [API_FOLDER],
    fileHint: `A view folder holds ${viewFile}, its style file, ${LOADER_FILE} and index.ts. ${ELSEWHERE}`,
    folderHint: ELSEWHERE,
  });
}
