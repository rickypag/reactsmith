import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';

/** A component folder name: "UserCard". */
export const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** The component folder is named in PascalCase, like the component it holds. */
export function namingIssues(unit: TreeUnit): Issue[] {
  if (COMPONENT_NAME.test(unit.name)) return [];
  return [{
    severity: 'error',
    code: 'component-naming',
    path: unit.folderRel,
    message: `Component folder "${unit.name}" is not PascalCase.`,
    hint: 'Name it like the component it holds, e.g. "UserCard".',
  }];
}
