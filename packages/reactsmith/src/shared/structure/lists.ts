import ts from 'typescript';
import { conditionShape, isConditionExpression } from '../elements/conditions.js';
import { listShape, mapCall } from '../elements/lists.js';
import type { Issue } from '../issues.js';

const LIST_HINT = 'Write lists as {links.map((link) => <NavLink key={link.href} … />)}, e.g. with "element insert NavLink --each links --as link --key link.href".';
const CONDITION_HINT = 'Write conditions as {open && <Nav />}, {open ? <A /> : <B />} or {label ?? <Placeholder />}, with a name as the test, e.g. with "element insert Nav --into … --if open".';

/** Whether a `.map(…)` call is in `node`, not looking inside JSX: lists in nested JSX are checked where they are. */
function hasMapCall(node: ts.Node): boolean {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return false;
  if (ts.isCallExpression(node) && mapCall(node)) return true;
  return ts.forEachChild(node, hasMapCall) ?? false;
}

/**
 * Reports lists and conditions in JSX that are not in their shape. A list repeats one component, with a key,
 * over a variable. A condition tests a name and shows one element or one list per branch, or null.
 * Logic such as filtering or combined tests goes into a variable before them, or into a component.
 */
export function listShapeIssues(fileRel: string, text: string): Issue[] {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: Issue[] = [];
  const report = (node: ts.Node, code: string, what: string, reason: string, hint: string): void => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    issues.push({ severity: 'error', code, path: fileRel, message: `The ${what} on line ${line} is not in the ${what} shape: ${reason}.`, hint });
  };
  const checkList = (node: ts.Node, call: ts.CallExpression): void => {
    const shape = listShape(call, sourceFile);
    if (!shape.ok) report(node, 'list-shape-invalid', 'list', shape.reason, LIST_HINT);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const call = mapCall(node.expression);
      if (call) {
        checkList(node, call);
      } else if (isConditionExpression(node.expression)) {
        const shape = conditionShape(node.expression, sourceFile);
        if (!shape.ok) report(node, 'condition-shape-invalid', 'condition', shape.reason, CONDITION_HINT);
        else for (const branch of shape.condition.branches) if (branch.kind === 'list') checkList(node, branch.node as ts.CallExpression);
      } else if (hasMapCall(node.expression)) {
        report(node, 'list-shape-invalid', 'list', 'the list must be the whole {…}, or a branch of a condition, without other logic around it', LIST_HINT);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}
