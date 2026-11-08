import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { componentEntryProblems } from '../../component-file.js';

/** The entry point only re-exports the layout, which the routes render. */
export async function entryIssues(root: string, unit: TreeUnit): Promise<Issue[]> {
  const entryRel = `${unit.folderRel}/index.ts`;
  const text = await readFile(path.join(root, entryRel), 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  return componentEntryProblems(text, 'index.ts', unit.name).map((problem) => ({
    severity: 'error',
    code: 'layout-entry-invalid',
    path: entryRel,
    message: problem,
    hint: `It should only contain "export { ${unit.name} } from './${unit.name}';".`,
  }));
}
