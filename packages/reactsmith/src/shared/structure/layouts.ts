import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { listUnits } from '../tree/list-units.js';
import type { UnitOwner } from '../tree/types.js';
import { componentEntryProblems, componentFileProblems } from './component-file.js';
import { componentStyleIssues } from './component-styles.js';
import { inlineStyleIssues } from './inline-styles.js';
import { plainLinkIssues } from './links.js';
import { tableNestingIssues } from '../elements/table.js';
import { listShapeIssues } from './lists.js';
import { textPlacementIssues } from './text.js';

/** How many times the file renders React Router's <Outlet />, where the pages appear. */
function outletCount(text: string, fileName: string): number {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === 'Outlet') count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/** Where the parts of a layout go: the components of its owner. */
function partsOf(owner: UnitOwner): string {
  return 'feature' in owner ? `components of feature "${owner.feature}"` : 'app components';
}

/**
 * The content checks of every layout folder, until the content rules take them: a clean layout file rendering one
 * <Outlet />, and its entry point. Where the folders are and what is in them is the layouts rule's.
 */
export async function checkLayoutContents(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  for (const unit of await listUnits(root, config)) {
    if (unit.kind !== 'layout') continue;
    const { name, folderRel: entryRel } = unit;
    const parts = partsOf(unit.owner);
    const fileRel = `${entryRel}/${name}.tsx`;
    const text = await readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
    if (text !== undefined) {
      issues.push(...textPlacementIssues(root, config, fileRel, text), ...listShapeIssues(fileRel, text), ...plainLinkIssues(config, fileRel, text), ...tableNestingIssues(fileRel, text), ...inlineStyleIssues(config, fileRel, text));
      issues.push(...(await componentStyleIssues(root, config, fileRel, text)));
      for (const problem of componentFileProblems(text, `${name}.tsx`, name)) {
        issues.push({ severity: 'error', code: 'layout-file-content', path: fileRel, message: problem, hint: `A layout file holds only the layout component; put its parts in ${parts}.` });
      }
      const outlets = outletCount(text, `${name}.tsx`);
      if (outlets !== 1) {
        issues.push({
          severity: 'error',
          code: 'layout-outlet',
          path: fileRel,
          message: `Layout "${name}" renders <Outlet /> ${outlets} times, but the pages need exactly one place.`,
          hint: 'Render <Outlet /> (from "react-router") once, where the pages should appear.',
        });
      }
    }

    const indexRel = `${entryRel}/index.ts`;
    const indexText = await readFile(path.join(root, indexRel), 'utf8').catch(() => undefined);
    for (const problem of indexText === undefined ? [] : componentEntryProblems(indexText, 'index.ts', name)) {
      issues.push({ severity: 'error', code: 'layout-entry-invalid', path: indexRel, message: problem, hint: `It should only contain "export { ${name} } from './${name}';".` });
    }
  }
}
