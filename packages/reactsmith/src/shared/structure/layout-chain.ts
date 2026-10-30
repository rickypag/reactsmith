import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { findExportedRoutesName } from '../routes/add.js';
import { appRouterPath } from '../routes/app-router.js';

const parse = (fileName: string, text: string) => ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const read = (file: string) => readFile(file, 'utf8').catch(() => undefined);

function prop(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const found = object.properties.find((candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate) && ts.isIdentifier(candidate.name) && candidate.name.text === name);
  return found?.initializer;
}

/** The route objects of a routes file, at every depth. */
function routeObjects(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The layout a route renders, by its Component: "DocsLayout". */
function componentOf(route: ts.ObjectLiteralExpression): string | undefined {
  const component = prop(route, 'Component');
  return component && ts.isIdentifier(component) ? component.text : undefined;
}

/** Whether a route's children are, or hold, the routes array `name`: `children: docsRoutes` or `[{ children: docsRoutes }]`. */
function mounts(route: ts.ObjectLiteralExpression, name: string, sourceFile: ts.SourceFile): boolean {
  const children = prop(route, 'children');
  if (!children) return false;
  if (ts.isIdentifier(children)) return children.text === name;
  return new RegExp(`\\bchildren:\\s*${name}\\b`).test(children.getText(sourceFile));
}

/** The components a layout renders, besides the <Outlet />: TopBar, Sidebar. */
function renderedComponents(fileName: string, text: string): Set<string> {
  const sourceFile = parse(fileName, text);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (/^[A-Z]/.test(tag) && tag !== 'Outlet') found.add(tag);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

interface Layout {
  name: string;
  fileRel: string;
  /** The layouts around it, from the outermost: RootLayout, then an app layout a feature is mounted in. */
  parents: string[];
}

/**
 * Warns when a nested layout renders a component one of the layouts around it already renders: a TopBar in both
 * RootLayout and DocsLayout shows it twice on the page. A nested layout holds only its own part of the shell.
 */
export async function checkRepeatedShell(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const routerRel = appRouterPath(config);
  const routerText = routerRel ? await read(path.join(root, routerRel)) : undefined;
  if (!routerRel || routerText === undefined) return [];
  const router = parse(routerRel, routerText);
  const routes = routeObjects(router);
  const rootRoute = routes.find((route) => {
    const value = prop(route, 'path');
    return !!value && ts.isStringLiteralLike(value) && value.text === '/';
  });
  const rootLayout = rootRoute ? componentOf(rootRoute) : undefined;
  const { srcDir, folders, appFolders, featureFolders, featureRoutes } = config;
  const layouts: Layout[] = [];
  const fileOf = (dirRel: string, name: string) => `${dirRel}/${name}/${name}.tsx`;

  // App layouts render inside the root one; the router names them by their Component.
  if (folders.app && appFolders.layouts) {
    const dirRel = `${srcDir}/${folders.app}/${appFolders.layouts}`;
    for (const entry of await readdir(path.join(root, dirRel), { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory() && entry.name !== rootLayout) layouts.push({ name: entry.name, fileRel: fileOf(dirRel, entry.name), parents: rootLayout ? [rootLayout] : [] });
    }
  }
  // A feature's layout renders inside the app layout its routes are mounted in, and the root one.
  if (featureFolders.layouts && featureRoutes) {
    const featuresRel = `${srcDir}/${folders.features}`;
    for (const feature of await readdir(path.join(root, featuresRel), { withFileTypes: true }).catch(() => [])) {
      if (!feature.isDirectory()) continue;
      const dirRel = `${featuresRel}/${feature.name}/${featureFolders.layouts}`;
      const entries = (await readdir(path.join(root, dirRel), { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory());
      if (!entries.length) continue;
      const routesText = await read(path.join(root, featuresRel, feature.name, featureRoutes));
      const routesName = routesText === undefined ? undefined : findExportedRoutesName(routesText, featureRoutes);
      const holder = routesName ? routes.find((route) => route !== rootRoute && componentOf(route) && mounts(route, routesName, router)) : undefined;
      const parents = [...(rootLayout ? [rootLayout] : []), ...(holder ? [componentOf(holder)!] : [])];
      for (const entry of entries) layouts.push({ name: entry.name, fileRel: fileOf(dirRel, entry.name), parents });
    }
  }

  // What each layout renders, read once.
  const rendered = new Map<string, Set<string>>();
  const renderedBy = async (name: string, fileRel?: string): Promise<Set<string>> => {
    if (!rendered.has(name)) {
      const file = fileRel ?? (folders.app && appFolders.layouts ? fileOf(`${srcDir}/${folders.app}/${appFolders.layouts}`, name) : undefined);
      const text = file ? await read(path.join(root, file)) : undefined;
      rendered.set(name, text === undefined ? new Set() : renderedComponents(`${name}.tsx`, text));
    }
    return rendered.get(name)!;
  };

  const issues: Issue[] = [];
  for (const layout of layouts) {
    const own = await renderedBy(layout.name, layout.fileRel);
    for (const parent of layout.parents) {
      const repeated = [...(await renderedBy(parent))].filter((tag) => own.has(tag));
      if (!repeated.length) continue;
      issues.push({
        severity: 'warning',
        code: 'layout-repeats-parent',
        path: layout.fileRel,
        message: `${layout.name} renders ${repeated.join(', ')}, which ${parent} already renders around it: the page would show ${repeated.length === 1 ? 'it' : 'them'} twice.`,
        hint: `A nested layout holds only its own part: remove ${repeated.length === 1 ? 'it' : 'them'} from ${layout.name} ("element remove"), or from ${parent} if only some pages need ${repeated.length === 1 ? 'it' : 'them'}.`,
      });
    }
  }
  return issues;
}
