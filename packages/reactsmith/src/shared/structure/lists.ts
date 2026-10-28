import ts from 'typescript';
import { listShape, mapCall } from '../elements/lists.js';
import type { Issue } from '../issues.js';

const LIST_HINT = 'Write lists as {links.map((link) => <NavLink key={link.href} … />)}, e.g. with "element insert NavLink --each links --as link --key link.href".';

/** Whether a `.map(…)` call is somewhere inside `node`. */
function hasMapCall(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && mapCall(node)) return true;
  return ts.forEachChild(node, hasMapCall) ?? false;
}

/**
 * Reports lists in JSX that are not in the list shape: one component, with a key, repeated over a variable.
 * Logic such as filtering or conditions goes into a variable before the list, or into the component.
 */
export function listShapeIssues(fileRel: string, text: string): Issue[] {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: Issue[] = [];
  const report = (node: ts.Node, reason: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    issues.push({ severity: 'error', code: 'list-shape-invalid', path: fileRel, message: `The list on line ${line} is not in the list shape: ${reason}.`, hint: LIST_HINT });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const call = mapCall(node.expression);
      if (call) {
        const shape = listShape(call, sourceFile);
        if (!shape.ok) report(node, shape.reason);
      } else if (hasMapCall(node.expression)) {
        report(node, 'the list must be the whole {…}, without conditions or other logic around it');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}
