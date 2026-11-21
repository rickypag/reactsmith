import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { toPascalCase } from '../../../naming.js';
import type { TreeUnit } from '../../../tree/types.js';

const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;

/** The view folder is named in PascalCase, ending with "viewSuffix": "SettingsView". */
export function namingIssues(config: ResolvedConfig, unit: TreeUnit): Issue[] {
  const suffix = config.viewSuffix;
  if (!PASCAL_CASE.test(unit.name)) {
    return [{
      severity: 'error',
      code: 'view-naming',
      path: unit.folderRel,
      message: `View folder "${unit.name}" is not PascalCase.`,
      hint: `Name it like the view it holds, e.g. "${toPascalCase(unit.name)}${suffix && !toPascalCase(unit.name).endsWith(suffix) ? suffix : ''}".`,
    }];
  }
  if (suffix && (!unit.name.endsWith(suffix) || unit.name === suffix)) {
    return [{
      severity: 'error',
      code: 'view-naming',
      path: unit.folderRel,
      message: `View folder "${unit.name}" does not end with "${suffix}".`,
      hint: `Rename it to "${unit.name}${suffix}", or change "viewSuffix" in ${CONFIG_FILE}.`,
    }];
  }
  return [];
}
