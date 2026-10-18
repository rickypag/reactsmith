import ts from 'typescript';
import { addImport, insertListItem } from '../code/insert.js';

export type RootLayoutResult = { status: 'added'; text: string } | { status: 'exists' } | { status: 'manual'; reason: string };

/** What can render a route's UI: a route with one of these already has a layout or a page. */
const RENDER_PROPERTIES = ['Component', 'element', 'lazy'];

function parse(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function unwrap(expression: ts.Expression): ts.Expression {
  return ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((candidate) => candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === name);
}

function pathOf(object: ts.ObjectLiteralExpression): string | undefined {
  const value = property(object, 'path');
  return value && ts.isPropertyAssignment(value) && ts.isStringLiteralLike(value.initializer) ? value.initializer.text : undefined;
}

/** The routes array and its top-level route objects. */
function findRoutes(sourceFile: ts.SourceFile, routesName: string): ts.ArrayLiteralExpression | undefined {
  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === routesName && node.initializer) {
      const value = unwrap(node.initializer);
      if (ts.isArrayLiteralExpression(value)) found = value;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function topRoute(routes: ts.ArrayLiteralExpression, path: string): ts.ObjectLiteralExpression | undefined {
  return routes.elements.find((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(element) && pathOf(element) === path);
}

function indentAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(text.lastIndexOf('\n', offset - 1) + 1))![0];
}

/** Removes an array element with its comma and, when it is alone on its lines, the lines themselves. */
function removeElement(text: string, sourceFile: ts.SourceFile, element: ts.Node): string {
  let start = element.getStart(sourceFile);
  let end = element.getEnd();
  const comma = /^\s*,/.exec(text.slice(end));
  if (comma) end += comma[0].length;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  if (text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '') [start, end] = [lineStart, lineEnd];
  return text.slice(0, start) + text.slice(end);
}

/**
 * Makes `component` the layout of the "/" route: sets its Component, moves the catch-all "*" route
 * inside it so unknown URLs keep the layout, and imports the layout. Keeps the file's formatting.
 */
export function mountRootLayout(text: string, fileName: string, routesName: string, component: string, importStatement: string): RootLayoutResult {
  let sourceFile = parse(text, fileName);
  let routes = findRoutes(sourceFile, routesName);
  if (!routes) return { status: 'manual', reason: `could not find "const ${routesName} = [...]" in ${fileName}` };
  if (!topRoute(routes, '/')) return { status: 'manual', reason: `${fileName} has no "/" route to hold the layout` };
  if (RENDER_PROPERTIES.some((name) => property(topRoute(routes!, '/')!, name))) return { status: 'exists' };

  // Take the catch-all route out of the top level, to put it under the layout.
  const catchAll = topRoute(routes, '*');
  const catchAllText = catchAll?.getText(sourceFile);
  if (catchAll) {
    text = removeElement(text, sourceFile, catchAll);
    sourceFile = parse(text, fileName);
    routes = findRoutes(sourceFile, routesName)!;
  }

  // Component goes right after the path: "path: '/', Component: RootLayout, children: [...]".
  const root = topRoute(routes, '/')!;
  const pathProperty = property(root, 'path')!;
  const comma = /^\s*,/.exec(text.slice(pathProperty.getEnd()));
  const at = pathProperty.getEnd() + (comma ? comma[0].length : 0);
  const sameLine = !text.slice(root.getStart(sourceFile), pathProperty.getStart(sourceFile)).includes('\n');
  const insertion = sameLine ? ` Component: ${component},` : `\n${indentAt(text, pathProperty.getStart(sourceFile))}Component: ${component},`;
  text = text.slice(0, at) + (comma ? '' : ',') + insertion + text.slice(at);

  if (catchAllText) {
    sourceFile = parse(text, fileName);
    const children = property(topRoute(findRoutes(sourceFile, routesName)!, '/')!, 'children');
    const list = children && ts.isPropertyAssignment(children) ? unwrap(children.initializer) : undefined;
    if (!list || !ts.isArrayLiteralExpression(list)) return { status: 'manual', reason: 'the "/" route has no children array for the "*" route' };
    text = insertListItem(text, sourceFile, list, [catchAllText]);
  }
  return { status: 'added', text: addImport(text, parse(text, fileName), importStatement) };
}
