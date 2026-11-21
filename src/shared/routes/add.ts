import ts from 'typescript';
import { addImport, insertListItem } from '../code/insert.js';

export type AddRouteResult = { status: 'added'; text: string } | { status: 'manual'; reason: string };

/** The array literal assigned to `const <name>`, looking through `as` and `satisfies`. */
function findRoutesArray(sourceFile: ts.SourceFile, name: string): ts.ArrayLiteralExpression | undefined {
  let found: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      const value = unwrap(node.initializer);
      if (ts.isArrayLiteralExpression(value)) found = value;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Where the pages of a routes array are: the array itself, or, when it only holds a layout route without a path
 * (`[{ Component: DocsLayout, children: [...] }]`, a feature's layout), that route's children.
 */
function pagesArray(sourceFile: ts.SourceFile, name: string): ts.ArrayLiteralExpression | undefined {
  const routes = findRoutesArray(sourceFile, name);
  const only = routes?.elements.length === 1 ? routes.elements[0] : undefined;
  if (!only || !ts.isObjectLiteralExpression(only) || findProperty(only, 'path') || findProperty(only, 'index') || !findProperty(only, 'Component')) return routes;
  const children = findProperty(only, 'children')?.initializer;
  return children && ts.isArrayLiteralExpression(children) ? children : routes;
}

/** Adds a route object, given as code, to the pages of the routes array `routesName`. Keeps the file's formatting. */
export function addRouteEntry(text: string, fileName: string, routesName: string, entry: string): AddRouteResult {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = pagesArray(sourceFile, routesName);
  if (!routes) return { status: 'manual', reason: `could not find "const ${routesName} = [...]" in ${fileName}` };
  // The catch-all stays last, where it reads as "everything else".
  const last = routes.elements[routes.elements.length - 1];
  if (last && ts.isObjectLiteralExpression(last) && stringValue(last, 'path') === '*') {
    const at = last.getStart(sourceFile);
    const indent = /[ \t]*$/.exec(text.slice(0, at))![0];
    return { status: 'added', text: `${text.slice(0, at)}${entry},\n${indent}${text.slice(at)}` };
  }
  return { status: 'added', text: insertListItem(text, sourceFile, routes, [entry]) };
}

function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name,
  );
}

function stringValue(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = findProperty(object, name)?.initializer;
  return initializer && ts.isStringLiteralLike(initializer) ? initializer.text : undefined;
}

export interface MountOptions {
  /** Variable holding the app's routes, e.g. "routes". */
  routesName: string;
  /** Path of the route whose children receive the feature, e.g. "/". */
  parentPath: string;
  /** Path of the new child route, e.g. "user-profile", or "" for a child without a path (at most one). */
  path: string;
  /** The child route as code, e.g. "{ path: 'user-profile', children: userProfileRoutes }". */
  entry: string;
  /** Import statement for what the entry uses, without a trailing semicolon. */
  importStatement: string;
}

export type MountResult = AddRouteResult | { status: 'exists' };

/** Adds a child route under the route at `parentPath`, plus its import. Keeps the file's formatting. */
export function mountChildRoute(text: string, fileName: string, options: MountOptions): MountResult {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = findRoutesArray(sourceFile, options.routesName);
  const parent = routes?.elements.find(
    (element): element is ts.ObjectLiteralExpression =>
      ts.isObjectLiteralExpression(element) && stringValue(element, 'path') === options.parentPath,
  );
  const children = parent ? findProperty(parent, 'children')?.initializer : undefined;
  if (!children || !ts.isArrayLiteralExpression(children)) {
    return {
      status: 'manual',
      reason: `could not find the route with path "${options.parentPath}" and its "children" in ${fileName}`,
    };
  }
  const taken = children.elements.some((element) => {
    if (!ts.isObjectLiteralExpression(element)) return false;
    if (options.path !== '') return stringValue(element, 'path') === options.path;
    return !findProperty(element, 'path') && !findProperty(element, 'index') && !!findProperty(element, 'children');
  });
  if (taken) return { status: 'exists' };

  const mounted = insertListItem(text, sourceFile, children, [options.entry]);
  return { status: 'added', text: addImport(mounted, sourceFile, options.importStatement) };
}

function unwrap(value: ts.Expression): ts.Expression {
  while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) {
    value = value.expression;
  }
  return value;
}

/** The name of the routes array a feature's routes file exports, e.g. "docsRoutes". */
export function findExportedRoutesName(text: string, fileName: string): string | undefined {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isArrayLiteralExpression(unwrap(declaration.initializer))) {
        return declaration.name.text;
      }
    }
  }
  return undefined;
}

/**
 * Where the router mounts `routesName` ("docs" for `{ path: 'docs', children: docsRoutes }`),
 * "" for a route without a path, or undefined when it is not mounted.
 */
export function findMountedPath(text: string, fileName: string, routesName: string): string | undefined {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let mounted: string | undefined;
  const visit = (node: ts.Node): void => {
    if (mounted !== undefined) return;
    if (ts.isObjectLiteralExpression(node)) {
      const children = findProperty(node, 'children')?.initializer;
      if (children && ts.isIdentifier(children) && children.text === routesName) {
        mounted = stringValue(node, 'path') ?? '';
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return mounted;
}

export interface RouteSummary {
  /** The route's path, if it has one. */
  path?: string;
  index: boolean;
}

/** The pages of the array `routesName` (inside its layout route, if it has one), or undefined when the array is not found. */
export function listRoutes(text: string, fileName: string, routesName: string): RouteSummary[] | undefined {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = pagesArray(sourceFile, routesName);
  if (!routes) return undefined;
  return routes.elements.filter(ts.isObjectLiteralExpression).map((route) => {
    const index = findProperty(route, 'index')?.initializer;
    return { path: stringValue(route, 'path'), index: index?.kind === ts.SyntaxKind.TrueKeyword };
  });
}

export type ViewRouteResult =
  | { status: 'updated'; text: string; from: string }
  | { status: 'same' }
  | { status: 'taken' }
  | { status: 'missing' };

/** Where a route renders, for messages: "(index)" or the path. */
function targetOf(route: ts.ObjectLiteralExpression): string | undefined {
  const index = findProperty(route, 'index')?.initializer;
  if (index?.kind === ts.SyntaxKind.TrueKeyword) return '(index)';
  return stringValue(route, 'path');
}

/**
 * Sets where the route of a view renders, among the pages of `routesName`: its index (`routePath` undefined) or a
 * path. The route is the one loading the view's folder (`import('./views/SettingsView')`). Refused (`taken`) when
 * another route is there already.
 */
export function setViewRoute(text: string, fileName: string, routesName: string, viewName: string, routePath: string | undefined): ViewRouteResult {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const pages = pagesArray(sourceFile, routesName);
  const loads = new RegExp(`import\\(\\s*['"]([^'"]*/)?${viewName}(/index)?['"]\\s*\\)`);
  const elements: readonly ts.Expression[] = pages?.elements ?? [];
  const routes = elements.filter((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(element));
  const route = routes.find((candidate) => loads.test(candidate.getText(sourceFile)));
  if (!route) return { status: 'missing' };
  const wanted = routePath === undefined ? '(index)' : routePath;
  const from = targetOf(route) ?? '';
  if (from === wanted) return { status: 'same' };
  if (routes.some((other) => other !== route && targetOf(other) === wanted)) return { status: 'taken' };

  const code = routePath === undefined ? 'index: true' : `path: '${routePath}'`;
  const current = findProperty(route, 'index') ?? findProperty(route, 'path');
  const updated = current
    ? `${text.slice(0, current.getStart(sourceFile))}${code}${text.slice(current.getEnd())}`
    : `${text.slice(0, route.getStart(sourceFile) + 1)} ${code},${text.slice(route.getStart(sourceFile) + 1)}`;
  return { status: 'updated', text: updated, from };
}
