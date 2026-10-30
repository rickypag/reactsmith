import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { publicImport } from '../structure/imports.js';
import { renderTemplate } from '../templates/render.js';
import { planViewCreate } from '../views/create.js';
import { addRouteEntry, findMountedPath, mountChildRoute } from './add.js';
import { mountInLayout } from './layout-mount.js';

/** The variable holding the app's routes in the generated router file. */
const APP_ROUTES = 'routes';
/** Features are mounted as children of this route, which will also hold the app layout. */
const ROOT_PATH = '/';

/** Project-relative path of the app router file, when the config has one. */
export function appRouterPath(config: ResolvedConfig): string | undefined {
  if (!config.router || !config.folders.app || !config.appRouter) return undefined;
  return `${config.srcDir}/${config.folders.app}/${config.appRouter}`;
}

/**
 * Plans the app router when a router is configured and the file does not exist yet:
 * a root route for the features, and a "not found" app view for everything else.
 */
export async function planAppRouterCreate(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  const routerRel = appRouterPath(config);
  if (!routerRel) return;
  if ((await changes.read(routerRel)) !== undefined) {
    changes.skip(routerRel, 'app router already exists');
    return;
  }

  let text = await renderTemplate(`react-router/${config.router!.mode}/app-router.tsx`, {});
  const viewsFolder = config.appFolders.views;
  if (viewsFolder) {
    const viewsRel = `${config.srcDir}/${config.folders.app}/${viewsFolder}`;
    const viewName = `NotFound${config.viewSuffix}`;
    if (!(await stat(changes.resolve(`${viewsRel}/${viewName}`)).catch(() => undefined))) {
      await planViewCreate(changes, config, viewsRel, viewName, { title: 'Page not found' });
    }
    const entry = `{ path: '*', lazy: () => import('${relativeImport(routerRel, `${viewsRel}/${viewName}/index.ts`)}') }`;
    const added = addRouteEntry(text, path.posix.basename(routerRel), APP_ROUTES, entry);
    if (added.status !== 'added') throw new Error(`The app router template is not editable: ${added.reason}`);
    text = added.text;
  }
  changes.write(routerRel, text, { type: 'create', message: 'app router' });
}

/** "/users/" → "users". Throws for paths that cannot be a route path. */
export function normalizeRoutePath(value: string): string {
  const routePath = value.trim().replace(/^\/+|\/+$/g, '');
  const segments = routePath.split('/');
  if (routePath === '' || !/^[A-Za-z0-9\-_.:/]+$/.test(routePath) || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new IssueError({
      severity: 'error',
      code: 'route-path-invalid',
      message: `"${value}" is not a valid route path.`,
      hint: 'Use letters, digits and dashes, e.g. "user-profile" or "settings/account".',
    });
  }
  return routePath;
}

/** Like normalizeRoutePath, but "/" is allowed: it mounts a feature at the root, giving "". */
export function normalizeMountPath(value: string): string {
  return /^\s*\/+\s*$/.test(value) ? '' : normalizeRoutePath(value);
}

/** Where the app router mounts `routesName`, e.g. "/docs", or undefined when it does not. */
export async function findFeatureMount(changes: ChangeSet, config: ResolvedConfig, routesName: string): Promise<string | undefined> {
  const routerRel = appRouterPath(config);
  const text = routerRel ? await changes.read(routerRel) : undefined;
  if (!routerRel || text === undefined) return undefined;
  const mounted = findMountedPath(text, path.posix.basename(routerRel), routesName);
  return mounted === undefined ? undefined : `/${mounted.replace(/^\/+/, '')}`;
}

/**
 * Plans mounting a feature's routes in the app router, under the root route.
 * An empty `routePath` mounts it at the root itself, as a route without a path; only one feature can be there.
 * Returns false when the router file is missing or not in the generated shape: the step is then left as a todo.
 */
export async function planFeatureMount(
  changes: ChangeSet,
  config: ResolvedConfig,
  feature: string,
  routesName: string,
  routePath: string,
): Promise<boolean> {
  const routerRel = appRouterPath(config);
  const entry = routePath === '' ? `{ children: ${routesName} }` : `{ path: '${routePath}', children: ${routesName} }`;
  const text = routerRel ? await changes.read(routerRel) : undefined;
  if (!routerRel || text === undefined) {
    changes.todo(routerRel ?? config.srcDir, `mount the feature: add ${entry} to your app routes`);
    return false;
  }

  const apiFile = `${config.srcDir}/${config.folders.features}/${feature}/${config.featurePublicApi ?? 'index.ts'}`;
  const from = config.alias ? publicImport(config, feature) : relativeImport(routerRel, apiFile);
  const result = mountChildRoute(text, path.posix.basename(routerRel), {
    routesName: APP_ROUTES,
    parentPath: ROOT_PATH,
    path: routePath,
    entry,
    importStatement: `import { ${routesName} } from '${from}'`,
  });

  if (result.status === 'exists') {
    throw new IssueError({
      severity: 'error',
      code: 'route-path-taken',
      path: routerRel,
      message:
        routePath === ''
          ? `Another feature is already mounted at the root in ${routerRel}.`
          : `The route path "/${routePath}" is already used in ${routerRel}.`,
      hint: routePath === '' ? 'Only one feature can be at the root: give this one a path with --path.' : 'Choose another path with --path.',
    });
  }
  if (result.status === 'manual') {
    changes.todo(routerRel, `mount the feature: add ${entry} to your app routes (${result.reason})`);
    return false;
  }
  changes.write(routerRel, result.text, { type: 'update', message: `mounted ${routesName} at /${routePath}` });
  return true;
}

/**
 * Plans mounting a feature's routes inside an app layout, at `routePath` from the root ("" for the root itself). A
 * feature mounted elsewhere moves under the layout. Returns where it is mounted, or undefined when it already was
 * there (reported as a skip) or the step is left as a todo.
 */
export async function planFeatureLayoutMount(
  changes: ChangeSet,
  config: ResolvedConfig,
  feature: string,
  routesName: string,
  routePath: string,
  layout: string,
): Promise<string | undefined> {
  const routerRel = appRouterPath(config);
  const layouts = config.folders.app && config.appFolders.layouts ? `${config.srcDir}/${config.folders.app}/${config.appFolders.layouts}` : undefined;
  if (layout === 'RootLayout') {
    throw new IssueError({ severity: 'error', code: 'layout-is-root', message: 'Every page already renders inside RootLayout.', hint: 'Leave out --layout, or pass a nested app layout, e.g. --layout DocsLayout.' });
  }
  if (!layouts || (await changes.read(`${layouts}/${layout}/index.ts`)) === undefined) {
    throw new IssueError({ severity: 'error', code: 'layout-missing', message: `There is no app layout "${layout}".`, hint: `Create it first: "layout create ${layout}".` });
  }
  const text = routerRel ? await changes.read(routerRel) : undefined;
  if (!routerRel || text === undefined) {
    changes.todo(routerRel ?? config.srcDir, `mount the feature inside ${layout}: add { path: '${routePath}', Component: ${layout}, children: ${routesName} } to your app routes`);
    return undefined;
  }

  const apiFile = `${config.srcDir}/${config.folders.features}/${feature}/${config.featurePublicApi ?? 'index.ts'}`;
  const result = mountInLayout(text, {
    routesName: APP_ROUTES,
    parentPath: ROOT_PATH,
    layout,
    featureRoutes: routesName,
    path: routePath,
    featureImport: `import { ${routesName} } from '${config.alias ? publicImport(config, feature) : relativeImport(routerRel, apiFile)}'`,
    layoutImport: `import { ${layout} } from '${relativeImport(routerRel, `${layouts}/${layout}/index.ts`)}'`,
  });
  if (result.status === 'exists') {
    changes.skip(routerRel, `${routesName} already renders inside ${layout}`);
    return undefined;
  }
  if (result.status === 'taken') {
    throw new IssueError({ severity: 'error', code: 'route-path-taken', path: routerRel, message: `Another feature is already mounted at /${routePath} inside ${layout}.`, hint: 'Choose another path with --path.' });
  }
  if (result.status === 'outside') {
    throw new IssueError({ severity: 'error', code: 'layout-path-mismatch', path: routerRel, message: `${layout} renders at /${result.layoutPath}: /${routePath} is not under it.`, hint: `Pass a path under it, e.g. --path ${result.layoutPath}/${feature}.` });
  }
  if (result.status === 'manual') {
    changes.todo(routerRel, `mount the feature inside ${layout} by hand (${result.reason})`);
    return undefined;
  }
  changes.write(routerRel, result.text, { type: 'update', message: `mounted ${routesName} at ${result.at} inside ${layout}` });
  return result.at;
}

/** Like normalizeRoutePath, but "*" is allowed: a view at it catches the URLs no other route of its feature matches. */
export function normalizeViewPath(value: string): string {
  return value.trim() === '*' ? '*' : normalizeRoutePath(value);
}
