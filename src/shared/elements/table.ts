import ts from 'typescript';
import type { Issue } from '../issues.js';

/** HTML table elements and what each holds, as HTML fixes it. Components are allowed anywhere: a row component's root is a tr. */
const TABLE_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  table: ['caption', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr'],
  thead: ['tr'],
  tbody: ['tr'],
  tfoot: ['tr'],
  tr: ['td', 'th'],
};

/** The elements that only go into a table element, and where. */
const TABLE_PARENTS: Readonly<Record<string, readonly string[]>> = {
  caption: ['table'],
  colgroup: ['table'],
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  tr: ['table', 'thead', 'tbody', 'tfoot'],
  td: ['tr'],
  th: ['tr'],
};

/** Table elements, cells included: their layout is the table's, so they take no layout options (no flex). */
export function isTableElement(tag: string): boolean {
  return tag in TABLE_CHILDREN || tag in TABLE_PARENTS;
}

const isHtml = (tag: string) => /^[a-z]/.test(tag);
const list = (tags: readonly string[]) => tags.map((tag) => `<${tag}>`).join(', ');

/**
 * What is wrong with `child` inside `parent`, by the table rules: a row outside a table, a span in a row.
 * Undefined when it is fine, or when either is a component, whose content can't be known here.
 */
export function tableNestingProblem(parent: string, child: string): { message: string; hint: string } | undefined {
  if (!isHtml(parent)) return undefined;
  const allowed = TABLE_CHILDREN[parent];
  if (allowed && (child === '#icon' || (isHtml(child) && !allowed.includes(child)))) {
    const what = child === '#icon' ? 'an icon' : `<${child}>`;
    return { message: `<${parent}> holds only ${list(allowed)}${parent === 'table' ? '' : ' (or components rendering them)'}, not ${what}.`, hint: parent === 'tr' ? 'Put it in a cell: a <td>, or a <th> for a header.' : `Put it in a ${list(allowed.slice(-1))} first.` };
  }
  const parents = isHtml(child) ? TABLE_PARENTS[child] : undefined;
  if (parents && !parents.includes(parent)) {
    return { message: `<${child}> goes only into ${list(parents)}, not into <${parent}>.`, hint: `Insert it into a ${list(parents.slice(-1))}.` };
  }
  return undefined;
}

/** Reports table elements nested against the table rules, in the JSX of a file. */
export function tableNestingIssues(fileRel: string, text: string): Issue[] {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: Issue[] = [];
  const tagOf = (node: ts.JsxElement | ts.JsxSelfClosingElement) => (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const parent = tagOf(node);
      for (const child of node.children) {
        if (!ts.isJsxElement(child) && !ts.isJsxSelfClosingElement(child)) continue;
        const problem = tableNestingProblem(parent, tagOf(child));
        if (!problem) continue;
        const line = sourceFile.getLineAndCharacterOfPosition(child.getStart(sourceFile)).line + 1;
        issues.push({ severity: 'error', code: 'table-content-invalid', path: fileRel, message: `${problem.message} (line ${line})`, hint: `${problem.hint} Browsers move what doesn't belong out of the table.` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}
