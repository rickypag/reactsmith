import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { API_FOLDER, COMPONENT_API_FILES, VIEW_API_FILES } from '../../api.js';
import { fileMissingIssues } from './file-missing-issues.js';
import { unexpectedEntryIssues } from './unexpected-entry-issues.js';

/**
 * Api: what is inside the api/ folder of each component and view, when it has one. Only queries.ts (and, for a
 * component, mutations.ts), and at least one of them. Not this rule's: whether a unit may have api/ (the unit rules),
 * the split of a component that has one (components), and what the files contain (the content rules).
 */
export async function checkApi(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of await listUnits(root, config)) {
    if (unit.kind === 'layout') continue;
    const entries = await readDir(path.join(root, unit.folderRel, API_FOLDER));
    if (!entries) continue;
    const allowed = unit.kind === 'view' ? VIEW_API_FILES : COMPONENT_API_FILES;
    issues.push(...unexpectedEntryIssues(unit, entries, allowed), ...fileMissingIssues(unit, entries, allowed));
  }
  return issues;
}
