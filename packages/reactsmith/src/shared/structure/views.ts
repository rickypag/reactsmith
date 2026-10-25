import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { checkApiFolder, VIEW_API_FILES } from './api.js';
import { componentFileProblems, viewEntryProblems } from './component-file.js';
import { plainLinkIssues } from './links.js';
import { listShapeIssues } from './lists.js';
import { textPlacementIssues } from './text.js';

const VIEW_FILE_HINT =
  'A view file holds only the view (an arrow function typed React.FC) and, if needed, its props interface. ' +
  "Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.";

async function readOptional(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

/** Checks one views folder: each view in its own folder, with a clean view file, entry point and api/ folder. */
async function checkViewsFolder(root: string, config: ResolvedConfig, viewsRel: string, issues: Issue[]): Promise<void> {
  const entries = await readdir(path.join(root, viewsRel), { withFileTypes: true }).catch(() => undefined);
  for (const entry of (entries ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRel = `${viewsRel}/${entry.name}`;
    if (!entry.isDirectory()) {
      const name = entry.name.replace(/\.[^.]+$/, '');
      issues.push({
        severity: 'error',
        code: 'view-not-in-folder',
        path: entryRel,
        message: `"${entry.name}" is directly in ${viewsRel}/, but each view lives in its own folder.`,
        hint: `Move it to ${viewsRel}/${name}/${entry.name} and add an index.ts exporting it as Component.`,
      });
      continue;
    }

    const viewName = entry.name;
    const viewRel = `${entryRel}/${viewName}.tsx`;
    const viewText = await readOptional(path.join(root, viewRel));
    if (viewText === undefined) {
      issues.push({
        severity: 'error',
        code: 'view-file-missing',
        path: entryRel,
        message: `View folder "${viewName}" has no ${viewName}.tsx.`,
        hint: 'The view file is named like its folder.',
      });
    } else {
      issues.push(...textPlacementIssues(root, config, viewRel, viewText), ...listShapeIssues(viewRel, viewText), ...plainLinkIssues(config, viewRel, viewText));
      for (const problem of componentFileProblems(viewText, `${viewName}.tsx`, viewName)) {
        issues.push({ severity: 'error', code: 'view-file-content', path: viewRel, message: problem, hint: VIEW_FILE_HINT });
      }
    }

    const entryFileRel = `${entryRel}/index.ts`;
    const entryText = await readOptional(path.join(root, entryFileRel));
    if (entryText === undefined) {
      issues.push({
        severity: 'error',
        code: 'view-entry-missing',
        path: entryRel,
        message: `View folder "${viewName}" has no index.ts.`,
        hint: `Add index.ts with "export { ${viewName} as Component } from './${viewName}';".`,
      });
    } else {
      for (const problem of viewEntryProblems(entryText, 'index.ts')) {
        issues.push({
          severity: 'error',
          code: 'view-entry-invalid',
          path: entryFileRel,
          message: problem,
          hint: `It should only contain "export { ${viewName} as Component } from './${viewName}';" (and the loader, if any).`,
        });
      }
    }

    await checkApiFolder(root, entryRel, 'view', VIEW_API_FILES, issues);
  }
}

/** Checks the views of every feature and of the app folder. */
export async function checkViews(root: string, config: ResolvedConfig, features: string[], issues: Issue[]): Promise<void> {
  const featureViews = config.featureFolders.views;
  if (featureViews) {
    for (const feature of features) {
      await checkViewsFolder(root, config, `${config.srcDir}/${config.folders.features}/${feature}/${featureViews}`, issues);
    }
  }
  if (config.folders.app && config.appFolders.views) {
    await checkViewsFolder(root, config, `${config.srcDir}/${config.folders.app}/${config.appFolders.views}`, issues);
  }
}
