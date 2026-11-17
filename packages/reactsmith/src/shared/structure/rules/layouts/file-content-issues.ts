import ts from 'typescript';
import type { ResolvedConfig } from '../../../config/types.js';
import { isNext } from '../../../framework/detect.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { componentFileProblems } from '../../component-file.js';
import type { UnitFile } from '../unit-files.js';
import { partsOf } from './parts-of.js';

/** Where the pages appear in a layout: React Router's <Outlet />, or in a Next.js app the children its layout.tsx passes in. */
const PAGES_SLOT = {
  outlet: { shown: '<Outlet />', hint: 'Render <Outlet /> (from "react-router") once, where the pages should appear.' },
  children: { shown: '{children}', hint: 'Render {children} once, where the pages should appear: the layout.tsx of Next\'s app folder passes them in.' },
} as const;

/** How many times the file renders the pages: <Outlet /> elements, or {children} expressions. */
function slotCount(text: string, fileName: string, slot: keyof typeof PAGES_SLOT): number {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (slot === 'outlet' && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === 'Outlet') count++;
    if (slot === 'children' && ts.isJsxExpression(node) && node.expression && ts.isIdentifier(node.expression) && node.expression.text === 'children') count++;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

/** The layout file holds only the layout component, which renders the pages exactly once: <Outlet />, or {children} in Next. */
export function fileContentIssues(config: ResolvedConfig, unit: TreeUnit, files: UnitFile[]): Issue[] {
  const slotKey = isNext(config) ? 'children' : 'outlet';
  const slot = PAGES_SLOT[slotKey];
  return files.flatMap((file): Issue[] => {
    const issues: Issue[] = componentFileProblems(file.text, `${file.component}.tsx`, file.component).map((problem) => ({
      severity: 'error',
      code: 'layout-file-content',
      path: file.fileRel,
      message: problem,
      hint: `A layout file holds only the layout component; put its parts in ${partsOf(unit, false)}.`,
    }));
    const count = slotCount(file.text, `${file.component}.tsx`, slotKey);
    if (count !== 1) {
      issues.push({
        severity: 'error',
        code: 'layout-outlet',
        path: file.fileRel,
        message: `Layout "${unit.name}" renders ${slot.shown} ${count} times, but the pages need exactly one place.`,
        hint: slot.hint,
      });
    }
    return issues;
  });
}
