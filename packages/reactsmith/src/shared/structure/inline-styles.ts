import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError, type Issue } from '../issues.js';

/** The words of a class string: "mt-2 opacity-50" → 2. */
function countClasses(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The plain classes of a className value: a string, or the text parts of a template string. */
function plainClasses(initializer: ts.JsxAttributeValue | undefined): number {
  if (!initializer) return 0;
  if (ts.isStringLiteral(initializer)) return countClasses(initializer.text);
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  if (!expression) return 0;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return countClasses(expression.text);
  if (ts.isTemplateExpression(expression)) {
    return countClasses([expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(' '));
  }
  return 0;
}

/** An inline style problem of an element: what it "has", and how to fix it. */
interface InlineStyleProblem {
  code: 'inline-style-limit' | 'inline-style-not-literal';
  what: string;
  hint: string;
}

const LIMIT_HINT = (limit: number) =>
  `Move them to the element's style in its style file, e.g. "style update <element> --css …" (or --class with Tailwind). The limit is "inlineStyleLimit" (${limit}) in the config.`;

/**
 * The properties of an inline style, or why it can't be counted: it must be an object written in place, with plain
 * properties, so the style can be read, checked and updated. style={{ marginTop: 8 }} → 1.
 */
function styleProperties(attribute: ts.JsxAttribute, sourceFile: ts.SourceFile): number | string {
  const initializer = attribute.initializer;
  const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
  if (!expression || !ts.isObjectLiteralExpression(expression)) return `a style that is not written in place (${attribute.getText(sourceFile)})`;
  const spread = expression.properties.find((property) => ts.isSpreadAssignment(property));
  if (spread) return `a style that spreads another object (${spread.getText(sourceFile)})`;
  return expression.properties.length;
}

/**
 * What an element styles inline against the rules: a style that isn't an object written in place, or more style
 * properties (style={{…}}) or plain classes (className="…") than allowed. Styles normally come from the style file,
 * through className={styles.x}.
 */
export function inlineStyleProblems(attributes: ts.JsxAttributes, sourceFile: ts.SourceFile, limit: number): InlineStyleProblem[] {
  const problems: InlineStyleProblem[] = [];
  for (const attribute of attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    const name = attribute.name.getText(sourceFile);
    if (name !== 'style' && name !== 'className') continue;
    const count = name === 'style' ? styleProperties(attribute, sourceFile) : plainClasses(attribute.initializer);
    if (typeof count === 'string') {
      problems.push({ code: 'inline-style-not-literal', what: count, hint: 'Write the style in place, style={{ marginTop: 8 }}, or move it to the style file with "style update".' });
    } else if (count > limit) {
      const what = name === 'style' ? (count === 1 ? 'style property' : 'style properties') : count === 1 ? 'class' : 'classes';
      problems.push({ code: 'inline-style-limit', what: `${count} inline ${what}, more than the ${limit} allowed`, hint: LIMIT_HINT(limit) });
    }
  }
  return problems;
}

/** Reports the elements of a component, view or layout file that style too much inline. */
export function inlineStyleIssues(config: ResolvedConfig, fileRel: string, text: string): Issue[] {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: Issue[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      for (const problem of inlineStyleProblems(node.attributes, sourceFile, config.inlineStyleLimit)) {
        issues.push({ severity: 'error', code: problem.code, path: fileRel, message: `<${node.tagName.getText(sourceFile)}> (line ${line}) has ${problem.what}.`, hint: problem.hint });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

/** Refuses a new element, written as JSX, that breaks the inline style rules: commands don't write what check rejects. */
export function assertInlineStyleLimit(config: ResolvedConfig, jsx: string, tag: string): void {
  const sourceFile = ts.createSourceFile('element.tsx', `${jsx};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let element: ts.JsxOpeningElement | ts.JsxSelfClosingElement | undefined;
  const find = (node: ts.Node): void => {
    if (element) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) element = node;
    else ts.forEachChild(node, find);
  };
  find(sourceFile);
  const [problem] = element ? inlineStyleProblems(element.attributes, sourceFile, config.inlineStyleLimit) : [];
  if (problem) {
    throw new IssueError({ severity: 'error', code: problem.code, message: `<${tag}> would have ${problem.what}.`, hint: problem.hint });
  }
}
