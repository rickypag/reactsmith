import ts from 'typescript';
import { addImport, insertListItem } from '../code/insert.js';
import { removeElement } from './layout.js';

export interface LayoutMountOptions {
  /** Variable holding the app's routes, e.g. "routes". */
  routesName: string;
  /** Path of the route whose children hold the layout's route, e.g. "/". */
  parentPath: string;
  /** The app layout, e.g. "DocsLayout". */
  layout: string;
  /** The feature's routes array, e.g. "docsRoutes". */
  featureRoutes: string;
  /** Where the feature's pages go, from the root: "docs", "docs/cli", or "" for the root itself. */
  path: string;
  /** Imports the entries use, without trailing semicolons: the feature's routes, and the layout. */
  featureImport: string;
  layoutImport: string;
}

export type LayoutMountResult =
  | { status: 'added'; text: string; at: string }
  | { status: 'exists' }
  | { status: 'taken' }
  | { status: 'outside'; layoutPath: string }
  | { status: 'manual'; reason: string };

const parse = (text: string) => ts.createSourceFile('router.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function unwrap(value: ts.Expression): ts.Expression {
  while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value)) value = value.expression;
  return value;
}

function prop(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find((candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name);
}

function pathOf(object: ts.ObjectLiteralExpression): string | undefined {
  const value = prop(object, 'path')?.initializer;
  return value && ts.isStringLiteralLike(value) ? value.text : undefined;
}

/** The children array of the route at `parentPath` in the routes array `routesName`. */
function parentChildren(sourceFile: ts.SourceFile, options: LayoutMountOptions): ts.ArrayLiteralExpression | undefined {
  let routes: ts.ArrayLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (routes) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === options.routesName && node.initializer) {
      const value = unwrap(node.initializer);
      if (ts.isArrayLiteralExpression(value)) routes = value;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const parent = routes?.elements.find((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(element) && pathOf(element) === options.parentPath);
  const children = parent && prop(parent, 'children')?.initializer;
  return children && ts.isArrayLiteralExpression(children) ? children : undefined;
}

/** The route rendering the layout, among the children: `{ path: 'docs', Component: DocsLayout, children: … }`. */
function layoutRoute(children: ts.ArrayLiteralExpression, layout: string): ts.ObjectLiteralExpression | undefined {
  return children.elements.find((element): element is ts.ObjectLiteralExpression => {
    const component = ts.isObjectLiteralExpression(element) ? prop(element, 'Component')?.initializer : undefined;
    return !!component && ts.isIdentifier(component) && component.text === layout;
  });
}

/** The route object mounting the feature's routes (`children: docsRoutes`), anywhere in the file. */
function featureMount(sourceFile: ts.SourceFile, featureRoutes: string): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const children = ts.isObjectLiteralExpression(node) ? prop(node, 'children')?.initializer : undefined;
    if (children && ts.isIdentifier(children) && children.text === featureRoutes) {
      found = node as ts.ObjectLiteralExpression;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Mounts a feature's routes inside an app layout. Every feature under the layout shares its one route, so the layout
 * stays mounted while navigating between them:
 * `{ path: 'docs', Component: DocsLayout, children: [{ children: docsRoutes }, { path: 'cli', children: cliRoutes }] }`.
 * A feature mounted elsewhere moves under the layout. The first feature gets the short form, `children: docsRoutes`.
 */
export function mountInLayout(text: string, options: LayoutMountOptions): LayoutMountResult {
  let sourceFile = parse(text);
  let children = parentChildren(sourceFile, options);
  if (!children) return { status: 'manual', reason: `could not find the route with path "${options.parentPath}" and its "children"` };

  // Already inside the layout: nothing to do. Mounted elsewhere: it leaves that place.
  const current = featureMount(sourceFile, options.featureRoutes);
  if (current) {
    const holder = layoutRoute(children, options.layout);
    let inside = false;
    for (let node: ts.Node | undefined = current; node && !inside; node = node.parent) inside = node === holder;
    if (inside) return { status: 'exists' };
    if (ts.isArrayLiteralExpression(current.parent)) {
      text = removeElement(text, sourceFile, current);
      sourceFile = parse(text);
      children = parentChildren(sourceFile, options)!;
    } else {
      return { status: 'manual', reason: `${options.featureRoutes} is mounted in a shape this command doesn't edit` };
    }
  }

  const holder = layoutRoute(children, options.layout);
  if (!holder) {
    const entry = options.path === ''
      ? `{ Component: ${options.layout}, children: ${options.featureRoutes} }`
      : `{ path: '${options.path}', Component: ${options.layout}, children: ${options.featureRoutes} }`;
    const added = insertListItem(text, sourceFile, children, [entry]);
    const withLayout = addImport(added, parse(added), options.layoutImport);
    return { status: 'added', text: dedupeImports(addImport(withLayout, parse(withLayout), options.featureImport)), at: `/${options.path}` };
  }

  // The feature's path, from the layout's route.
  const layoutPath = pathOf(holder) ?? '';
  const relative = layoutPath === '' ? options.path : options.path === layoutPath ? '' : options.path.startsWith(`${layoutPath}/`) ? options.path.slice(layoutPath.length + 1) : undefined;
  if (relative === undefined) return { status: 'outside', layoutPath };
  const entry = relative === '' ? `{ children: ${options.featureRoutes} }` : `{ path: '${relative}', children: ${options.featureRoutes} }`;

  const holderChildren = prop(holder, 'children')!.initializer;
  let updated: string;
  if (ts.isIdentifier(holderChildren)) {
    // The short form holds one feature, at the layout's path: it becomes a list.
    if (relative === '') return { status: 'taken' };
    updated = `${text.slice(0, holderChildren.getStart(sourceFile))}[{ children: ${holderChildren.text} }, ${entry}]${text.slice(holderChildren.getEnd())}`;
  } else if (ts.isArrayLiteralExpression(holderChildren)) {
    const taken = holderChildren.elements.some((element) => ts.isObjectLiteralExpression(element) && (relative === '' ? !prop(element, 'path') && !prop(element, 'index') : pathOf(element) === relative));
    if (taken) return { status: 'taken' };
    updated = insertListItem(text, sourceFile, holderChildren, [entry]);
  } else {
    return { status: 'manual', reason: `the children of the ${options.layout} route are not a list` };
  }
  return { status: 'added', text: dedupeImports(addImport(updated, parse(updated), options.featureImport)), at: `/${options.path}` };
}

/** Drops an import statement that appears twice (the feature's, when it was already imported for its old place). */
function dedupeImports(text: string): string {
  const sourceFile = parse(text);
  const seen = new Set<string>();
  const edits: [number, number][] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const code = statement.getText(sourceFile).replace(/;$/, '');
    if (seen.has(code)) edits.push([statement.getFullStart(), statement.getEnd()]);
    seen.add(code);
  }
  return edits.reverse().reduce((updated, [start, end]) => `${updated.slice(0, start)}${updated.slice(end)}`, text);
}
