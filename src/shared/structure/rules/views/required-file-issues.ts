import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';

/** The view folder has its view file, named like the folder, and its entry point, which the routes load. */
export function requiredFileIssues(unit: TreeUnit, files: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (!files.has(`${unit.name}.tsx`)) {
    issues.push({
      severity: 'error',
      code: 'view-file-missing',
      path: unit.folderRel,
      message: `View folder "${unit.name}" has no ${unit.name}.tsx.`,
      hint: 'The view file is named like its folder.',
    });
  }
  if (!files.has('index.ts')) {
    issues.push({
      severity: 'error',
      code: 'view-entry-missing',
      path: unit.folderRel,
      message: `View folder "${unit.name}" has no index.ts.`,
      hint: `Add index.ts with "export { ${unit.name} as Component } from './${unit.name}';".`,
    });
  }
  return issues;
}
