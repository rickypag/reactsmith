import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { findSpecifiers, specifierPath } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { appRouterPath } from '../routes/app-router.js';

const isFolder = (file: string) => stat(file).then((info) => info.isDirectory(), () => false);
const isFile = (file: string) => stat(file).then((info) => info.isFile(), () => false);

/** A view or layout folder, given as a path relative to srcDir: the folder must exist with its entry point. */
async function existsWithEntry(srcAbs: string, folderRel: string): Promise<boolean> {
  return (await isFolder(path.join(srcAbs, folderRel))) && (await isFile(path.join(srcAbs, folderRel, 'index.ts')));
}

/** "views/QueriesView" from "features/docs/views/QueriesView" under "features/docs": the folder kind and name, or undefined. */
function folderUnder(targetRelToSrc: string, scopeRel: string): { folder: string; name: string; rest: string[] } | undefined {
  if (!targetRelToSrc.startsWith(`${scopeRel}/`)) return undefined;
  const [folder, name, ...rest] = targetRelToSrc.slice(scopeRel.length + 1).split('/');
  return folder && name ? { folder, name, rest } : undefined;
}

interface RoutesFile {
  fileRel: string;
  /** Where the file is: a feature ("features/docs") or the app ("app"), relative to srcDir. */
  scopeRel: string;
  /** What it may route to besides its views: the app router also mounts layouts and features. */
  isAppRouter: boolean;
}

/**
 * Checks that routes render views: a feature's routes file only imports its own views and layouts (and its own types), and the
 * app router only app views, app layouts and the features it mounts. A component used as a page, another feature's
 * view, or a view folder that doesn't exist is an error.
 */
export async function checkRouteTargets(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.router) return [];
  const { srcDir, folders, featureFolders, appFolders, featureRoutes } = config;
  const srcAbs = path.join(root, srcDir);
  const files: RoutesFile[] = [];

  const appRouter = appRouterPath(config);
  if (appRouter && folders.app) files.push({ fileRel: appRouter, scopeRel: folders.app, isAppRouter: true });
  if (featureRoutes) {
    const featuresAbs = path.join(srcAbs, folders.features!);
    const features = new Set((await listFiles(featuresAbs).catch(() => [])).map((file) => toRelative(featuresAbs, file).split('/')[0]!));
    for (const feature of features) files.push({ fileRel: `${srcDir}/${folders.features}/${feature}/${featureRoutes}`, scopeRel: `${folders.features}/${feature}`, isAppRouter: false });
  }

  const issues: Issue[] = [];
  for (const { fileRel, scopeRel, isAppRouter } of files) {
    const text = await readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const views = isAppRouter ? appFolders.views : featureFolders.views;
    const types = isAppRouter ? undefined : featureFolders.types;

    for (const { value } of findSpecifiers(text)) {
      const target = specifierPath(value, path.join(root, fileRel), srcAbs, config.alias);
      if (!target) continue;
      const targetRelToSrc = toRelative(srcAbs, target.base);
      const own = folderUnder(targetRelToSrc, scopeRel);

      if (own && own.folder === views) {
        if (await existsWithEntry(srcAbs, `${scopeRel}/${views}/${own.name}`)) continue;
        issues.push({ severity: 'error', code: 'route-not-a-view', path: fileRel, message: `"${value}" points to the view "${own.name}", which doesn't exist.`, hint: `Create it with "view create ${own.name}", or fix the route.` });
        continue;
      }
      if (own && types !== undefined && own.folder === types) continue;
      // Routes also render layouts: the app's in the app router, a feature's own in its routes.
      const layouts = isAppRouter ? appFolders.layouts : featureFolders.layouts;
      if (own && layouts !== undefined && own.folder === layouts && (await existsWithEntry(srcAbs, `${scopeRel}/${layouts}/${own.name}`))) continue;
      // The app router mounts the features' routes through their public API.
      if (isAppRouter && targetRelToSrc.startsWith(`${folders.features}/`)) continue;

      const where = isAppRouter ? 'the app router' : `the routes of feature "${scopeRel.split('/').pop()}"`;
      issues.push({
        severity: 'error',
        code: 'route-not-a-view',
        path: fileRel,
        message: `"${value}" is not a view of ${isAppRouter ? 'the app' : `feature "${scopeRel.split('/').pop()}"`}: ${where} only render${isAppRouter ? 's' : ''} ${isAppRouter ? 'app views, layouts and features' : 'its own views and layouts'}.`,
        hint: isAppRouter
          ? 'Make the page an app view ("view create" with the app), or mount the feature that has it.'
          : `Make the page a view of this feature ("view create <name> --feature ${scopeRel.split('/').pop()}"). Another feature's pages are mounted in the app router.`,
      });
    }
  }
  return issues;
}
