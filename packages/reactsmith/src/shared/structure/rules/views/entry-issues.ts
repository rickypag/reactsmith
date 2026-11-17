import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { isNext } from '../../../framework/detect.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { componentEntryProblems, viewEntryProblems } from '../../component-file.js';

/**
 * The entry point only re-exports the view: as Component, which React Router's lazy routes load, with its loader if it
 * has one; or, in a Next.js app, by its name, which the pages import.
 */
export async function entryIssues(root: string, config: ResolvedConfig, unit: TreeUnit): Promise<Issue[]> {
  const entryRel = `${unit.folderRel}/index.ts`;
  const text = await readFile(path.join(root, entryRel), 'utf8').catch(() => undefined);
  if (text === undefined) return [];
  const next = isNext(config);
  const problems = next ? componentEntryProblems(text, 'index.ts', unit.name, 'view') : viewEntryProblems(text, 'index.ts');
  return problems.map((problem) => ({
    severity: 'error',
    code: 'view-entry-invalid',
    path: entryRel,
    message: problem,
    hint: next
      ? `It should only contain "export { ${unit.name} } from './${unit.name}';", which the pages import.`
      : `It should only contain "export { ${unit.name} as Component } from './${unit.name}';" (and the loader, if any).`,
  }));
}
