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
 * Views: each view folder (of a feature or of the app) and what is directly inside it. Its name, the files and
 * folders it may hold, the files it must have, what its entry point exports, and a view file holding only the view.
 * Not this rule's: the files of a views folder (file-placement) and what is inside api/ (api).
 */
export async function checkViews(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of (await listUnits(root, config)).filter((candidate) => candidate.kind === 'view')) {
    const naming = namingIssues(config, unit);
    issues.push(...naming);
    if (naming.length > 0) continue;

    const entries = (await readDir(path.join(root, unit.folderRel))) ?? [];
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    issues.push(...unexpectedEntryIssues(config, unit, entries), ...requiredFileIssues(unit, files), ...(await entryIssues(root, config, unit)), ...fileContentIssues(await unitFiles(root, unit)));
  }
  return issues;
}
