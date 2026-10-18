import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Issue } from '../issues.js';

/** The folder in a view or component that holds its data access. */
export const API_FOLDER = 'api';

/** Data fetching: a view's main data (used by its loader) or a component's own queries. */
export const QUERIES_FILE = 'queries.ts';

/** Data editing. Only components have it: views load data, the components inside them edit it. */
export const MUTATIONS_FILE = 'mutations.ts';

export const VIEW_API_FILES = [QUERIES_FILE] as const;
export const COMPONENT_API_FILES = [QUERIES_FILE, MUTATIONS_FILE] as const;

/**
 * Checks the optional api/ folder of a view or component at `ownerRel`: when present, it must hold
 * at least one of the `allowed` files and nothing else.
 */
export async function checkApiFolder(
  root: string,
  ownerRel: string,
  owner: 'view' | 'component',
  allowed: readonly string[],
  issues: Issue[],
): Promise<void> {
  const apiRel = `${ownerRel}/${API_FOLDER}`;
  const entries = await readdir(path.join(root, apiRel), { withFileTypes: true }).catch(() => undefined);
  if (!entries) return;
  const fileList = allowed.map((file) => `${apiRel}/${file}`).join(' or ');

  let found = false;
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && allowed.includes(entry.name)) {
      found = true;
      continue;
    }
    const entryRel = `${apiRel}/${entry.name}`;
    if (owner === 'view' && entry.name === MUTATIONS_FILE) {
      issues.push({
        severity: 'error',
        code: 'api-unexpected-file',
        path: entryRel,
        message: `Views only load data, so a view's ${API_FOLDER}/ has no ${MUTATIONS_FILE}.`,
        hint: `Move each mutation to the ${API_FOLDER}/${MUTATIONS_FILE} of the component that edits the data.`,
      });
      continue;
    }
    issues.push({
      severity: 'error',
      code: 'api-unexpected-file',
      path: entryRel,
      message: `"${entry.name}" is not allowed in ${apiRel}/, which may only contain ${allowed.join(' and ')}.`,
      hint: `Move queries to ${apiRel}/${QUERIES_FILE}${owner === 'component' ? ` and mutations to ${apiRel}/${MUTATIONS_FILE}` : ''}. Other code belongs in the feature's hooks/, utils/ or types/ folders.`,
    });
  }

  if (found) return;
  issues.push({
    severity: 'error',
    code: 'api-file-missing',
    path: apiRel,
    message: `The ${API_FOLDER}/ folder of ${owner} "${path.posix.basename(ownerRel)}" has no ${allowed.join(' or ')}.`,
    hint: `Add ${fileList}, or remove the ${API_FOLDER}/ folder if the ${owner} has no data access.`,
  });
}
