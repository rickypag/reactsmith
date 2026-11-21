import type { Issue } from '../../../issues.js';
import { toPascalCase } from '../../../naming.js';
import type { TreeUnit } from '../../../tree/types.js';

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

/** The layout folder is named in PascalCase, like the layout it holds: "DocsLayout". */
export function namingIssues(unit: TreeUnit): Issue[] {
  if (PASCAL_CASE.test(unit.name)) return [];
  return [{
    severity: 'error',
    code: 'layout-naming',
    path: unit.folderRel,
    message: `Layout folder "${unit.name}" is not PascalCase.`,
    hint: `Name it like the layout it holds, e.g. "${toPascalCase(unit.name)}".`,
  }];
}
