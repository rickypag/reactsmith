import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { nameTakenIssues } from './name-taken-issues.js';
import { namingIssues } from './naming-issues.js';
import { requiredFileIssues } from './required-file-issues.js';
import { splitIssues } from './split-issues.js';
import { unexpectedEntryIssues } from './unexpected-entry-issues.js';

/**
 * Components: each component folder (of a feature, of the app, of a type of shared components) and what is directly
 * inside it. Its name, the files and folders it may hold, the files it must have, the split of a component that loads
 * or edits data, and names unique in the project. Not this rule's: the files of a components folder (file-placement),
 * what is inside api/ (api), and what the files contain (the content rules).
 */
export async function checkComponents(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of (await listUnits(root, config)).filter((candidate) => candidate.kind === 'component')) {
    const naming = namingIssues(unit);
    issues.push(...naming);
    if (naming.length > 0) continue;

    const entries = (await readDir(path.join(root, unit.folderRel))) ?? [];
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    issues.push(
      ...unexpectedEntryIssues(config, unit, entries, files),
      ...requiredFileIssues(unit, files),
      ...(await splitIssues(root, unit, files)),
    );
  }
  return [...issues, ...(await nameTakenIssues(root, config))];
}
