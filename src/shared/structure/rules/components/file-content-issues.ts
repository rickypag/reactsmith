import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { findSpecifiers, specifierPath } from '../../../imports/specifiers.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER } from '../../api.js';
import { childrenIssues } from '../../children.js';
import { componentFileProblems } from '../../component-file.js';
import { CONTENT_SUFFIX, SKELETON_SUFFIX, type UnitFile } from '../unit-files.js';

const COMPONENT_FILE_HINT =
  'A component file holds only the component (an arrow function typed React.FC) and, if needed, its props interface. ' +
  'Move types to types.ts, helpers to utils.ts and constants to constants.ts (with "constant create").';

/** Content and Skeleton only get data through props: only the main component may use api/. */
function apiImportIssues(root: string, config: ResolvedConfig, unit: TreeUnit, file: UnitFile): Issue[] {
  if (!file.component.endsWith(CONTENT_SUFFIX) && !file.component.endsWith(SKELETON_SUFFIX)) return [];
  const absolute = path.join(root, file.fileRel);
  const apiDir = path.join(root, unit.folderRel, API_FOLDER);
  return findSpecifiers(file.text).flatMap((specifier): Issue[] => {
    const base = specifierPath(specifier.value, absolute, path.join(root, config.srcDir), config.alias)?.base;
    if (base === undefined || (base !== apiDir && !base.startsWith(apiDir + path.sep))) return [];
    return [{
      severity: 'error',
      code: 'component-content-imports-api',
      path: file.fileRel,
      message: `${file.component} imports "${specifier.value}", but only ${unit.name}.tsx may use ${API_FOLDER}/.`,
      hint: `Call the query or mutation in ${unit.name}.tsx and pass the data and callbacks to ${file.component} as props.`,
    }];
  });
}

/**
 * Each component file holds only its component and, if needed, its props interface, renders the children its props
 * declare, and, for Content and Skeleton, does not use api/.
 */
export function fileContentIssues(root: string, config: ResolvedConfig, unit: TreeUnit, files: UnitFile[]): Issue[] {
  return files.flatMap((file) => [
    ...childrenIssues(file.fileRel, file.text, file.component),
    ...componentFileProblems(file.text, `${file.component}.tsx`, file.component).map((problem): Issue => ({
      severity: 'error',
      code: 'component-file-content',
      path: file.fileRel,
      message: problem,
      hint: COMPONENT_FILE_HINT,
    })),
    ...apiImportIssues(root, config, unit, file),
  ]);
}
