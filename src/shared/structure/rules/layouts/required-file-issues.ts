import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';

/** The layout folder has its layout file, named like the folder, and its entry point. */
export function requiredFileIssues(unit: TreeUnit, files: Set<string>): Issue[] {
  const issues: Issue[] = [];
  if (!files.has(`${unit.name}.tsx`)) {
    issues.push({
      severity: 'error',
      code: 'layout-file-missing',
      path: unit.folderRel,
      message: `Layout folder "${unit.name}" has no ${unit.name}.tsx.`,
      hint: 'The layout file is named like its folder.',
    });
  }
  if (!files.has('index.ts')) {
    issues.push({
      severity: 'error',
      code: 'layout-entry-missing',
      path: unit.folderRel,
      message: `Layout folder "${unit.name}" has no index.ts.`,
      hint: `Add index.ts with "export { ${unit.name} } from './${unit.name}';".`,
    });
  }
  return issues;
}
