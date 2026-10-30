import ts from 'typescript';
import { mapCall } from './lists.js';

/**
 * A condition in JSX: `{open && <nav />}`, `{open ? <A /> : <B />}` (a branch may be null), or a fallback,
 * `{label ?? <Placeholder />}` and `{label || <Placeholder />}`, which shows the value, or the element when it is missing.
 * The test is a name; each branch is one element or one list. Any other logic goes into a variable before it.
 */
export interface Condition {
  operator: '&&' | '?:' | '||' | '??';
  /** The test as written: "open", "!open", "user.isAdmin"; for a fallback, the value: "label". */
  test: string;
  /** The branches that show something, in the order of the code: then, else. A null branch is left out. */
  branches: ConditionBranch[];
}

export interface ConditionBranch {
  /** The element, or the `.map(…)` call of a list. */
  node: ts.Expression;
  kind: 'element' | 'list';
  /** Which branch it is: what shows when the test holds, or the other one (for a fallback: the element). */
  branch: 'then' | 'else';
}

export type ConditionShape = { ok: true; condition: Condition } | { ok: false; reason: string };

const LOGICAL = new Map<ts.SyntaxKind, Condition['operator']>([
  [ts.SyntaxKind.AmpersandAmpersandToken, '&&'],
  [ts.SyntaxKind.BarBarToken, '||'],
  [ts.SyntaxKind.QuestionQuestionToken, '??'],
]);

export function unwrapParentheses(expression: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(expression) ? unwrapParentheses(expression.expression) : expression;
}

function isJsx(node: ts.Node): boolean {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

/** Whether JSX or a list is in `node`, not looking inside JSX: what makes an expression part of the structure. */
function holdsJsx(node: ts.Node): boolean {
  if (isJsx(node) || (ts.isCallExpression(node) && mapCall(node))) return true;
  if (ts.isFunctionLike(node)) return false;
  return ts.forEachChild(node, holdsJsx) ?? false;
}

/** Whether an expression is a condition of the structure: a `&&`, `||`, `??` or `? :` that shows JSX. Text values are not. */
export function isConditionExpression(expression: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(expression);
  const operator = ts.isBinaryExpression(unwrapped) ? LOGICAL.get(unwrapped.operatorToken.kind) : ts.isConditionalExpression(unwrapped) ? '?:' : undefined;
  return operator !== undefined && holdsJsx(unwrapped);
}

/** "open", "user.isAdmin": a variable or a property path, without calls or optional chaining. */
function isNamePath(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return true;
  return ts.isPropertyAccessExpression(expression) && !expression.questionDotToken && isNamePath(expression.expression);
}

/** "open" or "!open". */
function isTest(expression: ts.Expression): boolean {
  const unwrapped = unwrapParentheses(expression);
  if (ts.isPrefixUnaryExpression(unwrapped) && unwrapped.operator === ts.SyntaxKind.ExclamationToken) return isNamePath(unwrapParentheses(unwrapped.operand));
  return isNamePath(unwrapped);
}

const TEST_REASON = 'the test must be a name, e.g. {open && …} or {!open && …}: compute anything else first, e.g. "const hasItems = items.length > 0"';
const NESTED_REASON = 'a branch can\'t be another condition: compute the test in a variable first, e.g. "const show = open && ready"';
const BRANCH_REASON = 'each branch must be one element, one list or null: wrap several elements in one, e.g. a div';

/** What a branch is: nothing (null), one element, one list, or something a condition can't hold. */
function branchOf(expression: ts.Expression): { kind: 'element' | 'list' | 'null' } | { reason: string } {
  const node = unwrapParentheses(expression);
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: 'null' };
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return { kind: 'element' };
  if (ts.isCallExpression(node) && mapCall(node)) return { kind: 'list' };
  if (isConditionExpression(node)) return { reason: NESTED_REASON };
  return { reason: BRANCH_REASON };
}

/** Checks an expression against the shape of a condition. Call it on expressions for which isConditionExpression holds. */
export function conditionShape(expression: ts.Expression, sourceFile: ts.SourceFile): ConditionShape {
  const node = unwrapParentheses(expression);
  const branches: ConditionBranch[] = [];
  const add = (branch: ts.Expression, which: 'then' | 'else'): string | undefined => {
    const shape = branchOf(branch);
    if ('reason' in shape) return shape.reason;
    if (shape.kind !== 'null') branches.push({ node: unwrapParentheses(branch), kind: shape.kind, branch: which });
    return undefined;
  };

  if (ts.isConditionalExpression(node)) {
    if (!isTest(node.condition)) return { ok: false, reason: TEST_REASON };
    const problem = add(node.whenTrue, 'then') ?? add(node.whenFalse, 'else');
    if (problem) return { ok: false, reason: problem };
    if (branches.length === 0) return { ok: false, reason: 'both branches are null: it shows nothing' };
    return { ok: true, condition: { operator: '?:', test: unwrapParentheses(node.condition).getText(sourceFile), branches } };
  }

  if (ts.isBinaryExpression(node)) {
    const operator = LOGICAL.get(node.operatorToken.kind)!;
    const fallback = operator !== '&&';
    if (fallback ? !isNamePath(unwrapParentheses(node.left)) : !isTest(node.left)) {
      return { ok: false, reason: fallback ? `the value before ${operator} must be a name, e.g. {label ${operator} <Placeholder />}` : TEST_REASON };
    }
    const problem = add(node.right, fallback ? 'else' : 'then');
    if (problem) return { ok: false, reason: problem };
    if (branches.length === 0) return { ok: false, reason: `it shows nothing after ${operator}` };
    return { ok: true, condition: { operator, test: unwrapParentheses(node.left).getText(sourceFile), branches } };
  }
  return { ok: false, reason: 'it is not a condition' };
}
