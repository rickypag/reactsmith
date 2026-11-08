import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { unitFiles } from '../unit-files.js';
import { entryIssues } from './entry-issues.js';
import { fileContentIssues } from './file-content-issues.js';
import { namingIssues } from './naming-issues.js';
import { requiredFileIssues } from './required-file-issues.js';
import { unexpectedEntryIssues } from './unexpected-entry-issues.js';

/**
 * Layouts: each layout folder (of the app or of a feature) and what is directly inside it. Its name, the files and
 * folders it may hold, the files it must have, what its entry point exports, and a layout file holding only the
 * layout, rendering one <Outlet />. Not this rule's: the files of a layouts folder (file-placement).
 */
export async function checkLayouts(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of (await listUnits(root, config)).filter((candidate) => candidate.kind === 'layout')) {
    const naming = namingIssues(unit);
    issues.push(...naming);
    if (naming.length > 0) continue;

    const entries = (await readDir(path.join(root, unit.folderRel))) ?? [];
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    issues.push(...unexpectedEntryIssues(config, unit, entries), ...requiredFileIssues(unit, files), ...(await entryIssues(root, unit)), ...fileContentIssues(unit, await unitFiles(root, unit)));
  }
  return issues;
}
