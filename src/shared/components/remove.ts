import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles } from '../files.js';
import { IssueError } from '../issues.js';
import { barrelExportsOf, importersOf, projectImports } from './importers.js';
import { resolveComponent } from './update.js';
import { parseTsx } from './usages.js';

export interface ComponentRemoveResult {
  name: string;
  /** The removed folder, relative to the project root. */
  folder: string;
}

function removeError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/**
 * Plans deleting a component (of a feature, of the app, or shared) with its folder: its files, styles and anything
 * else in it. Refused while a file outside the folder still imports it, types included: its usages are removed
 * first, with "element remove". A shared component also leaves the barrel of its type, which goes with its last component.
 */
export async function planComponentRemove(changes: ChangeSet, config: ResolvedConfig, target: string): Promise<ComponentRemoveResult> {
  const component = await resolveComponent(changes.root, config, target);
  const { name, folderRel } = component;
  const isShared = !!config.folders.components && folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
  const barrelRel = `${path.posix.dirname(folderRel)}/index.ts`;
  const barrelText = isShared ? await changes.read(barrelRel) : undefined;
  const barrelNames = barrelText === undefined ? [] : barrelExportsOf(barrelRel, barrelText, name);

  const using = importersOf(await projectImports(changes.root, config, (fileRel) => changes.read(fileRel)), changes.root, component, barrelNames);
  if (using.length) {
    throw removeError('component-in-use', `"${name}" is still imported by ${using.join(', ')}.`, 'Remove its usages first, e.g. with "element remove", then remove the component.', using[0]);
  }

  const folderAbs = path.join(changes.root, folderRel);
  for (const file of (await listFiles(folderAbs).catch(() => [])).sort()) changes.delete(file, `part of "${name}"`);
  changes.removeIfEmpty(folderAbs);

  if (barrelText !== undefined) {
    const barrel = parseTsx(barrelRel, barrelText);
    const own = (statement: ts.Statement) => ts.isExportDeclaration(statement) && !!statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === `./${name}`;
    const kept = barrel.statements.filter((statement) => !own(statement));
    if (kept.length === 0) {
      changes.delete(barrelRel, 'the barrel of its type, now empty');
      changes.removeIfEmpty(path.dirname(folderAbs));
    } else if (kept.length < barrel.statements.length) {
      const text = `${kept.map((statement) => statement.getText(barrel)).join('\n')}\n`;
      changes.write(barrelRel, text, { type: 'update', message: `removed the exports of "${name}"` });
    }
  }
  return { name, folder: folderRel };
}
