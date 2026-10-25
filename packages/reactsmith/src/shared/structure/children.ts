import ts from 'typescript';
import { componentFunction } from '../elements/tree.js';
import type { Issue } from '../issues.js';
import { declaresChildren } from '../layout/classify.js';

/**
 * Warns about a component whose props declare children but which never renders them: whatever a parent puts inside
 * it would silently disappear. A warning, not an error: a component may have its reasons.
 */
export function childrenIssues(fileRel: string, text: string, component: string): Issue[] {
  if (!declaresChildren(text, component)) return [];
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, component);
  let rendered = false;
  const visit = (node: ts.Node): void => {
    if (rendered) return;
    // {children}, or children passed on: <Box>{children}</Box>, <Panel children={children} />.
    if (ts.isJsxExpression(node) && node.expression && /\bchildren\b/.test(node.expression.getText(sourceFile))) rendered = true;
    ts.forEachChild(node, visit);
  };
  if (fn) visit(fn);
  if (rendered) return [];
  return [
    {
      severity: 'warning',
      code: 'children-not-rendered',
      path: fileRel,
      message: `"${component}" declares children but never renders them, so what a parent puts inside it would not show.`,
      hint: 'Render {children} in its root (or where its content goes), or remove children from its props.',
    },
  ];
}
