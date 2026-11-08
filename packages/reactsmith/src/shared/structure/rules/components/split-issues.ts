import path from 'node:path';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER, MUTATIONS_FILE, QUERIES_FILE } from '../../api.js';
import { CONTENT_SUFFIX, SKELETON_SUFFIX } from '../unit-files.js';

/**
 * A component that loads or edits data is split: the main component (data, loading, errors), Content (the UI) and,
 * when it loads data, Skeleton (shown while loading).
 */
export async function splitIssues(root: string, unit: TreeUnit, files: Set<string>): Promise<Issue[]> {
  const apiFiles = new Set(((await readDir(path.join(root, unit.folderRel, API_FOLDER))) ?? []).map((entry) => entry.name));
  const loads = apiFiles.has(QUERIES_FILE);
  if (!loads && !apiFiles.has(MUTATIONS_FILE)) return [];

  const contentName = `${unit.name}${CONTENT_SUFFIX}`;
  const required = [
    { component: contentName, role: 'the UI, without data access' },
    ...(loads ? [{ component: `${unit.name}${SKELETON_SUFFIX}`, role: 'what is shown while loading' }] : []),
  ];
  const reason = loads ? `loads data (${API_FOLDER}/${QUERIES_FILE})` : `edits data (${API_FOLDER}/${MUTATIONS_FILE})`;
  return required
    .filter(({ component }) => !files.has(`${component}.tsx`))
    .map(({ component, role }) => ({
      severity: 'error',
      code: 'component-split-missing',
      path: unit.folderRel,
      message: `Component "${unit.name}" ${reason}, so it needs ${component}.tsx: ${role}.`,
      hint: `${unit.name}.tsx handles the data and its states, and renders ${required.map((r) => r.component).join(' or ')}.`,
    }));
}
