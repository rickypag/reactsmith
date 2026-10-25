import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE, TOOL_NAME } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { toNaming, toTitle } from '../naming.js';
import { addRouteEntry, findExportedRoutesName, listRoutes } from '../routes/add.js';
import { pageNameOf, planViewCreate } from './create.js';

export interface FeatureViewOptions {
  feature: string;
  /** PascalCase view name, with the suffix: "SettingsView". */
  viewName: string;
  /** Route path inside the feature ("settings", ":id"), or undefined for the index route. */
  routePath?: string;
  loader?: boolean;
}

export interface FeatureViewResult {
  /** The feature's routes array, e.g. "docsRoutes". */
  routesName: string;
}

function viewError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** "SettingsView" → "settings": the default route path of a view. */
export function defaultRoutePath(viewName: string, config: ResolvedConfig): string {
  return toNaming(pageNameOf(viewName, config), 'kebab-case');
}

/**
 * Plans a view in a feature and its route in the feature's routes file.
 * Everything is checked before anything is planned, so a refused view writes nothing.
 */
export async function planFeatureViewCreate(
  changes: ChangeSet,
  config: ResolvedConfig,
  options: FeatureViewOptions,
): Promise<FeatureViewResult> {
  const { feature, viewName, routePath } = options;
  const featureRel = `${config.srcDir}/${config.folders.features}/${feature}`;
  const viewsFolder = config.featureFolders.views;

  if (!config.router) {
    throw viewError('router-not-configured', 'Cannot create a view: no router is configured.', `Install React Router and run "${TOOL_NAME} init", then try again.`, CONFIG_FILE);
  }
  if (!config.featureRoutes) {
    throw viewError('feature-routes-disabled', 'Cannot create a view: "featureRoutes" is disabled.', `Set "featureRoutes" in ${CONFIG_FILE}.`, CONFIG_FILE);
  }
  if (!viewsFolder) {
    throw viewError('views-disabled', 'Cannot create a view: views are disabled ("featureFolders.views" is null).', `Set "featureFolders.views" in ${CONFIG_FILE}.`, CONFIG_FILE);
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(viewName)) {
    throw viewError('view-name-invalid', `"${viewName}" is not a valid view name.`, 'Use a name like "Settings" or "SettingsView".');
  }
  if (!(await stat(changes.resolve(featureRel)).catch(() => undefined))) {
    throw viewError('feature-not-found', `Feature "${feature}" does not exist.`, `Create it with "${TOOL_NAME} feature create ${feature}".`, featureRel);
  }

  const routesRel = `${featureRel}/${config.featureRoutes}`;
  const routesFile = path.posix.basename(routesRel);
  const routesText = await changes.read(routesRel);
  if (routesText === undefined) {
    throw viewError('feature-routes-missing', `Feature "${feature}" has no routes file ${config.featureRoutes}.`, `Run "${TOOL_NAME} feature create ${feature}" on a new feature, or add the routes file by hand.`, featureRel);
  }
  const routesName = findExportedRoutesName(routesText, routesFile);
  const routes = routesName ? listRoutes(routesText, routesFile, routesName) : undefined;
  if (!routesName || !routes) {
    throw viewError('feature-routes-unreadable', `${routesRel} exports no routes array.`, 'Export the routes as an array, e.g. "export const docsRoutes: RouteObject[] = [];".', routesRel);
  }
  if (routePath === undefined && routes.some((route) => route.index)) {
    throw viewError('index-route-exists', `Feature "${feature}" already has an index route.`, 'Give the view a path with --path.', routesRel);
  }
  if (routePath !== undefined && routes.some((route) => route.path === routePath)) {
    throw viewError('route-path-taken', `Feature "${feature}" already has a route "${routePath}".`, 'Choose another path with --path.', routesRel);
  }

  const viewsRel = `${featureRel}/${viewsFolder}`;
  await planViewCreate(changes, config, viewsRel, viewName, { title: toTitle(pageNameOf(viewName, config)), loader: options.loader });

  const target = routePath === undefined ? 'index: true' : `path: '${routePath}'`;
  const entry = `{ ${target}, lazy: () => import('${relativeImport(routesRel, `${viewsRel}/${viewName}/index.ts`)}') }`;
  const added = addRouteEntry(routesText, routesFile, routesName, entry);
  if (added.status !== 'added') throw new Error(`Routes array found but not editable: ${added.reason}`);
  changes.write(routesRel, added.text, { type: 'update', message: `added the route ${routePath === undefined ? '(index)' : `"${routePath}"`}` });

  return { routesName };
}
