import type { Dirent } from 'node:fs';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER, MUTATIONS_FILE, QUERIES_FILE } from '../../api.js';

/** The api/ folder holds only the files its unit may have: queries.ts for a view, queries.ts and mutations.ts for a component. */
export function unexpectedEntryIssues(unit: TreeUnit, entries: Dirent[], allowed: readonly string[]): Issue[] {
  const apiRel = `${unit.folderRel}/${API_FOLDER}`;
  return entries.flatMap((entry): Issue[] => {
    const isFolder = entry.isDirectory();
    if (!isFolder && allowed.includes(entry.name)) return [];
    const path = `${apiRel}/${entry.name}`;
    if (unit.kind === 'view' && !isFolder && entry.name === MUTATIONS_FILE) {
      return [{
        severity: 'error',
        code: 'api-unexpected-file',
        path,
        message: `Views only load data, so a view's ${API_FOLDER}/ has no ${MUTATIONS_FILE}.`,
        hint: `Move each mutation to the ${API_FOLDER}/${MUTATIONS_FILE} of the component that edits the data.`,
      }];
    }
    return [{
      severity: 'error',
      code: 'api-unexpected-file',
      path,
      message: `${isFolder ? 'Folder' : 'File'} "${entry.name}" is not allowed in ${apiRel}/, which may only contain ${allowed.join(' and ')}.`,
      hint: `Move queries to ${apiRel}/${QUERIES_FILE}${unit.kind === 'component' ? ` and mutations to ${apiRel}/${MUTATIONS_FILE}` : ''}. Other code belongs in the feature's hooks/, utils/ or types/ folders.`,
    }];
  });
}
