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
      await planViewCreate(changes, viewsRel, viewName, { title: 'Page not found' });
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
  const entry = `{ path: '${routePath}', children: ${routesName} }`;
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
      message: `The route path "/${routePath}" is already used in ${routerRel}.`,
      hint: 'Choose another path with --path.',
    });
  }
  if (result.status === 'manual') {
    changes.todo(routerRel, `mount the feature: add ${entry} to your app routes (${result.reason})`);
    return false;
  }
  changes.write(routerRel, result.text, { type: 'update', message: `mounted ${routesName} at /${routePath}` });
  return true;
}
