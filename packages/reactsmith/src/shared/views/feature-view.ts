import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { planBarrelExports } from '../code/barrel.js';
import { CONFIG_FILE, NEXT_APP_FOLDER, TOOL_NAME } from '../config/defaults.js';
import { publicImport } from '../structure/imports.js';
import type { ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import { IssueError, type Issue } from '../issues.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile } from '../imports/specifiers.js';
import { toNaming, toTitle } from '../naming.js';
import { addRouteEntry, findExportedRoutesName, listRoutes, setViewRoute } from '../routes/add.js';
import { pageNameOf, planViewCreate } from './create.js';

export interface FeatureViewOptions {
  feature: string;
  /** PascalCase view name, with the suffix: "SettingsView". */
  viewName: string;
  /** Route path inside the feature ("settings", ":id"), or undefined for the index route. */
  routePath?: string;
  loader?: boolean;
  /** Only the view's root, without its heading. */
  empty?: boolean;
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
 * Where a Next.js page for a feature's view goes: next to the feature's existing pages (the folder they share), or
 * in a folder named after the feature, inside a dynamic segment that holds the root layout ("[locale]") when there
 * is one. The feature's main view ("GalleryView" of "gallery") is that folder's own page.
 * "src/app/[locale]/support/help-center/page.tsx".
 */
export async function nextPagePath(changes: ChangeSet, config: ResolvedConfig, feature: string, viewName: string): Promise<string> {
  const appRel = `${config.srcDir}/${NEXT_APP_FOLDER}`;
  const files = (await listFiles(changes.resolve(appRel))).map((file) => toRelative(changes.root, file));
  // The segment the whole site sits in: "[locale]" with next-intl, when its layout.tsx is the root one.
  const segment = files.map((file) => new RegExp(`^${appRel}/(\\[[^/\\]]+\\])/layout\\.tsx$`).exec(file)?.[1]).find(Boolean);
  const base = segment ? `${appRel}/${segment}` : appRel;

  // The feature's pages: page.tsx files that import from the feature.
  const featureImport = new RegExp(`from\\s+['"][^'"]*/${config.folders.features}/${feature}(/[^'"]*)?['"]`);
  const pageDirs: string[] = [];
  for (const file of files.filter((candidate) => /\/page\.tsx$/.test(candidate))) {
    if (featureImport.test((await changes.read(file)) ?? '')) pageDirs.push(path.posix.dirname(file));
  }
  // Their shared folder, cut before any dynamic segment of one page ("gallery/[year]" → "gallery").
  let featureDir = pageDirs.length
    ? pageDirs.reduce((shared, dir) => {
        const [a, b] = [shared.split('/'), dir.split('/')];
        let index = 0;
        while (index < a.length && a[index] === b[index]) index++;
        return a.slice(0, index).join('/');
      })
    : `${base}/${toNaming(feature, 'kebab-case')}`;
  // Below the base only: "[locale]" itself stays.
  if (!featureDir.startsWith(base)) featureDir = base;
  featureDir = base + featureDir.slice(base.length).replace(/\/\[[^/]*\].*$/, '');
  const route = defaultRoutePath(viewName, config);
  return route === toNaming(feature, 'kebab-case') ? `${featureDir}/page.tsx` : `${featureDir}/${route}/page.tsx`;
}

/** The folder of a feature's view, relative to the root: "src/features/docs/views/SettingsView". */
export function featureViewRel(config: ResolvedConfig, feature: string, viewName: string): string {
  return `${config.srcDir}/${config.folders.features}/${feature}/${config.featureFolders.views ?? 'views'}/${viewName}`;
}

/** Whether a feature already has the view. */
export async function featureViewExists(changes: ChangeSet, config: ResolvedConfig, feature: string, viewName: string): Promise<boolean> {
  return !!(await stat(changes.resolve(featureViewRel(config, feature, viewName))).catch(() => undefined));
}

/** The feature's views folder, checked: the feature exists, views are enabled and the name is valid. */
async function featureViews(changes: ChangeSet, config: ResolvedConfig, feature: string, viewName: string) {
  const featureRel = `${config.srcDir}/${config.folders.features}/${feature}`;
  const viewsFolder = config.featureFolders.views;
  if (!viewsFolder) {
    throw viewError('views-disabled', 'Cannot create a view: views are disabled ("featureFolders.views" is null).', `Set "featureFolders.views" in ${CONFIG_FILE}.`, CONFIG_FILE);
  }
  if (!/^[A-Z][A-Za-z0-9]*$/.test(viewName)) {
    throw viewError('view-name-invalid', `"${viewName}" is not a valid view name.`, 'Use a name like "Settings" or "SettingsView".');
  }
  if (!(await stat(changes.resolve(featureRel)).catch(() => undefined))) {
    throw viewError('feature-not-found', `Feature "${feature}" does not exist.`, `Create it with "${TOOL_NAME} feature create ${feature}".`, featureRel);
  }
  return { featureRel, viewsRel: `${featureRel}/${viewsFolder}` };
}

/** The feature's routes file and its exported array, checked: what views are added to. */
async function featureRoutes(changes: ChangeSet, config: ResolvedConfig, feature: string, viewName: string) {
  if (!config.router) {
    throw viewError('router-not-configured', 'Cannot create a view: no router is configured.', `Install React Router and run "${TOOL_NAME} init", then try again.`, CONFIG_FILE);
  }
  if (!config.featureRoutes) {
    throw viewError('feature-routes-disabled', 'Cannot create a view: "featureRoutes" is disabled.', `Set "featureRoutes" in ${CONFIG_FILE}.`, CONFIG_FILE);
  }
  const { featureRel, viewsRel } = await featureViews(changes, config, feature, viewName);

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
  return { featureRel, viewsRel, routesRel, routesFile, routesText, routesName, routes };
}

/**
 * Plans a view in a feature of a Next.js app: the view, exported from the feature's public API, where the pages of
 * Next's app folder import it. Next routes the pages, so no route is added: the dev renders the view from a page.
 * Returns the import a page uses, e.g. "@/features/docs".
 */
export async function planNextFeatureViewCreate(changes: ChangeSet, config: ResolvedConfig, feature: string, viewName: string, empty = false): Promise<string> {
  const { featureRel, viewsRel } = await featureViews(changes, config, feature, viewName);
  await planViewCreate(changes, config, viewsRel, viewName, { title: toTitle(pageNameOf(viewName, config)), empty });
  if (!config.featurePublicApi) {
    const viewRelToSrc = `${viewsRel}/${viewName}`.slice(config.srcDir.length + 1);
    return config.alias ? `${config.alias}/${viewRelToSrc}` : relativeImport(`${config.srcDir}/${NEXT_APP_FOLDER}/page.tsx`, `${viewsRel}/${viewName}/index.ts`);
  }
  const apiRel = `${featureRel}/${config.featurePublicApi}`;
  await planBarrelExports(changes, apiRel, [`export { ${viewName} } from '${relativeImport(apiRel, `${viewsRel}/${viewName}/index.ts`)}';`]);
  return publicImport(config, feature);
}

/** The route entry loading a view: `{ index: true, lazy: () => import('./views/HomeView') }`. */
function routeEntry(routesRel: string, viewsRel: string, viewName: string, routePath: string | undefined): string {
  const target = routePath === undefined ? 'index: true' : `path: '${routePath}'`;
  return `{ ${target}, lazy: () => import('${relativeImport(routesRel, `${viewsRel}/${viewName}/index.ts`)}') }`;
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
  const { viewsRel, routesRel, routesFile, routesText, routesName, routes } = await featureRoutes(changes, config, feature, viewName);
  if (routePath === undefined && routes.some((route) => route.index)) {
    throw viewError('index-route-exists', `Feature "${feature}" already has an index route.`, 'Give the view a path with --path.', routesRel);
  }
  if (routePath !== undefined && routes.some((route) => route.path === routePath)) {
    throw viewError('route-path-taken', `Feature "${feature}" already has a route "${routePath}".`, 'Choose another path with --path.', routesRel);
  }

  await planViewCreate(changes, config, viewsRel, viewName, { title: toTitle(pageNameOf(viewName, config)), loader: options.loader, empty: options.empty });

  const added = addRouteEntry(routesText, routesFile, routesName, routeEntry(routesRel, viewsRel, viewName, routePath));
  if (added.status !== 'added') throw new Error(`Routes array found but not editable: ${added.reason}`);
  changes.write(routesRel, added.text, { type: 'update', message: `added the route ${routePath === undefined ? '(index)' : `"${routePath}"`}` });

  return { routesName };
}

export interface FeatureViewRouteResult extends FeatureViewResult {
  /** Where the route was before: "(index)", a path, or undefined when nothing changed or it was missing. */
  from?: string;
}

/**
 * Plans where an existing view of a feature renders: its route becomes the index (`routePath` undefined) or that
 * path. A view without a route gets one. Nothing else of the view changes.
 */
export async function planFeatureViewRoute(
  changes: ChangeSet,
  config: ResolvedConfig,
  options: Omit<FeatureViewOptions, 'loader'>,
): Promise<FeatureViewRouteResult> {
  const { feature, viewName, routePath } = options;
  const { viewsRel, routesRel, routesFile, routesText, routesName } = await featureRoutes(changes, config, feature, viewName);
  const wanted = routePath === undefined ? '(index)' : `"${routePath}"`;
  const result = setViewRoute(routesText, routesFile, routesName, viewName, routePath);

  if (result.status === 'same') {
    changes.skip(routesRel, `"${viewName}" is already at ${wanted}`);
    return { routesName };
  }
  if (result.status === 'taken') {
    throw routePath === undefined
      ? viewError('index-route-exists', `Feature "${feature}" already has an index route.`, `Give that view a path first ("view create <name> --feature ${feature} --path <path>"), then make "${viewName}" the index.`, routesRel)
      : viewError('route-path-taken', `Feature "${feature}" already has a route "${routePath}".`, 'Choose another path with --path.', routesRel);
  }
  if (result.status === 'missing') {
    const added = addRouteEntry(routesText, routesFile, routesName, routeEntry(routesRel, viewsRel, viewName, routePath));
    if (added.status !== 'added') throw new Error(`Routes array found but not editable: ${added.reason}`);
    changes.write(routesRel, added.text, { type: 'update', message: `added the missing route of "${viewName}" at ${wanted}` });
    return { routesName };
  }
  changes.write(routesRel, result.text, { type: 'update', message: `moved the route of "${viewName}": ${result.from === '(index)' ? '(index)' : `"${result.from}"`} → ${wanted}` });
  return { routesName, from: result.from };
}

/**
 * A warning listing the code files that still link to a page's old URL, as a string ('/docs/introduction'), after
 * its route moved. Links are logic and data: they are reported, not changed.
 */
export async function linksTo(changes: ChangeSet, config: ResolvedConfig, oldUrl: string, newUrl: string): Promise<Issue[]> {
  const escaped = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const quoted = new RegExp(`(['"\`])${escaped}\\1`);
  const files: string[] = [];
  for (const file of (await listFiles(changes.resolve(config.srcDir))).filter(isCodeFile)) {
    const fileRel = toRelative(changes.root, file);
    const text = await changes.read(fileRel);
    if (text && quoted.test(text)) files.push(fileRel);
  }
  if (!files.length) return [];
  return [{
    severity: 'warning',
    code: 'route-old-links',
    path: files[0],
    message: `${files.length === 1 ? 'A file still links' : `${files.length} files still link`} to ${oldUrl}, which is now ${newUrl}: ${files.join(', ')}.`,
    hint: 'Update the links, e.g. with "constant update" for navigation data or "element update --props" for a link.',
  }];
}
