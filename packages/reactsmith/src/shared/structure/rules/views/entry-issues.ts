import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { viewEntryProblems } from '../../component-file.js';

/** The entry point only re-exports the view as Component, which the routes load, and its loader if it has one. */
export async function entryIssues(root: string, unit: TreeUnit): Promise<Issue[]> {
  const entryRel = `${unit.folderRel}/index.ts`;
  const text = await readFile(path.join(root, entryRel), 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  return viewEntryProblems(text, 'index.ts').map((problem) => ({
    severity: 'error',
    code: 'view-entry-invalid',
    path: entryRel,
    message: problem,
    hint: `It should only contain "export { ${unit.name} as Component } from './${unit.name}';" (and the loader, if any).`,
  }));
}
