import ts from 'typescript';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { componentFileProblems } from '../../component-file.js';
import type { UnitFile } from '../unit-files.js';
import { partsOf } from './parts-of.js';

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

/** The layout file holds only the layout component, which renders <Outlet /> exactly once: where the pages go. */
export function fileContentIssues(unit: TreeUnit, files: UnitFile[]): Issue[] {
  return files.flatMap((file): Issue[] => {
    const issues: Issue[] = componentFileProblems(file.text, `${file.component}.tsx`, file.component).map((problem) => ({
      severity: 'error',
      code: 'layout-file-content',
      path: file.fileRel,
      message: problem,
      hint: `A layout file holds only the layout component; put its parts in ${partsOf(unit, false)}.`,
    }));
    const outlets = outletCount(file.text, `${file.component}.tsx`);
    if (outlets !== 1) {
      issues.push({
        severity: 'error',
        code: 'layout-outlet',
        path: file.fileRel,
        message: `Layout "${unit.name}" renders <Outlet /> ${outlets} times, but the pages need exactly one place.`,
        hint: 'Render <Outlet /> (from "react-router") once, where the pages should appear.',
      });
    }
    return issues;
  });
}
