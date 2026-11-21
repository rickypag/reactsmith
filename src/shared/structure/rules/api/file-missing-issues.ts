import type { Dirent } from 'node:fs';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER } from '../../api.js';

/** An api/ folder exists for its files: it holds at least one of them. */
export function fileMissingIssues(unit: TreeUnit, entries: Dirent[], allowed: readonly string[]): Issue[] {
  if (entries.some((entry) => entry.isFile() && allowed.includes(entry.name))) return [];
  const apiRel = `${unit.folderRel}/${API_FOLDER}`;
  return [{
    severity: 'error',
    code: 'api-file-missing',
    path: apiRel,
    message: `The ${API_FOLDER}/ folder of ${unit.kind} "${unit.name}" has no ${allowed.join(' or ')}.`,
    hint: `Add ${allowed.map((file) => `${apiRel}/${file}`).join(' or ')}, or remove the ${API_FOLDER}/ folder if the ${unit.kind} has no data access.`,
  }];
}
