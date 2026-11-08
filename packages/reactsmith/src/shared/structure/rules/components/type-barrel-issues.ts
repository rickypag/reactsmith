import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { componentTypes } from '../../../components/scope.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';

/** The barrel of each type of shared components only re-exports the components of the type. */
export async function typeBarrelIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const shared = config.tree.src.folders.find((folder) => folder.holds === 'components');
  if (!shared) return [];
  const issues: Issue[] = [];
  for (const type of componentTypes(config)) {
    const barrelRel = `${config.tree.srcDir}/${shared.name}/${type}/index.ts`;
    const text = await readFile(path.join(root, barrelRel), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const sourceFile = ts.createSourceFile(barrelRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
      issues.push({
        severity: 'error',
        code: 'component-type-barrel-content',
        path: barrelRel,
        message: `Line ${line} is not a re-export: the barrel only lists what the folder offers.`,
        hint: "Write the code in a component of the type, and re-export it: export { PrimaryButton } from './PrimaryButton';",
      });
    }
  }
  return issues;
}
