import type { Dirent } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkAliasSetup } from '../alias/check.js';
import { CONFIG_FILE, TOOL_NAME } from '../config/defaults.js';
import { loadConfig } from '../config/load.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue, Severity } from '../issues.js';
import { matchesNaming, toNaming } from '../naming.js';
import { APP_FILE_PATTERN, srcMissingIssue } from './app-files.js';
import { checkIconLibraries } from '../icons/library.js';
import { checkConstantsFiles } from '../constants/files.js';
import { checkCodeFolders } from './code-folders.js';
import { checkRouteTargets } from './route-targets.js';
import { checkRouter } from './router.js';
import { checkComponents } from './components.js';
import { projectComponents } from '../components/registry.js';
import { checkLayouts } from './layouts.js';
import { findFeatureCycles } from './cycles.js';
import { checkImports, publicImport } from './imports.js';
import { checkViews } from './views.js';
import { checkUnused } from './unused.js';

export interface CheckResult {
  root: string;
  configFound: boolean;
  issues: Issue[];
}

const UNKNOWN_FOLDER_CODES = {
  folders: 'unknown-folder',
  featureFolders: 'unknown-feature-folder',
  appFolders: 'unknown-app-folder',
} as const;

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

async function readDir(dir: string): Promise<Dirent[] | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Suggests the configured name when a folder only differs by case, e.g. "Components" vs "components". */
function caseHint(name: string, known: string[]): string | undefined {
  const match = known.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return match ? `Folder names are case-sensitive: rename it to "${match}".` : undefined;
}

function unknownFolderIssue(
  severity: Severity,
  relPath: string,
  message: string,
  configKey: keyof typeof UNKNOWN_FOLDER_CODES,
  name: string,
  known: string[],
): Issue {
  return {
    severity,
    code: UNKNOWN_FOLDER_CODES[configKey],
    path: relPath,
    message,
    hint:
      caseHint(name, known) ??
      `Remove or rename it, or add it to "${configKey}" in ${CONFIG_FILE}, e.g. "${name}": "${name}".`,
  };
}

function checkSrcRoot(config: ResolvedConfig, entries: Dirent[], issues: Issue[]): void {
  const { srcDir, folders, unknownFolders } = config;
  const knownNames = Object.values(folders);
  const known = new Set(knownNames);

  if (unknownFolders !== 'allow') {
    for (const entry of entries) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      issues.push(
        unknownFolderIssue(
          unknownFolders === 'error' ? 'error' : 'warning',
          `${srcDir}/${entry.name}`,
          `Unknown folder "${entry.name}" in ${srcDir}/.`,
          'folders',
          entry.name,
          knownNames,
        ),
      );
    }
  }

  const appFiles = entries.filter((entry) => entry.isFile() && APP_FILE_PATTERN.test(entry.name)).map((entry) => entry.name);
  if (appFiles.length === 0) return;
  const fileList = appFiles.join(', ');

  if (config.appFiles === 'app') {
    issues.push({
      severity: 'error',
      code: 'app-files-location',
      path: srcDir,
      message: `${fileList} must be in ${srcDir}/${folders.app}/, not in ${srcDir}/.`,
      hint: `Run "${TOOL_NAME} init" to move them and update their imports, or set "appFiles": "root" in ${CONFIG_FILE}.`,
    });
  } else if (config.appFiles === undefined) {
    issues.push({
      severity: 'warning',
      code: 'app-files-undecided',
      path: srcDir,
      message: `${fileList} ${appFiles.length === 1 ? 'is' : 'are'} in ${srcDir}/ and "appFiles" is not set.`,
      hint: `Run "${TOOL_NAME} init" to choose, or set "appFiles" in ${CONFIG_FILE} to "app" (move them to ${srcDir}/${folders.app ?? 'app'}/) or "root" (keep them where they are).`,
    });
  }
}

async function checkAppFolder(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  const { srcDir, folders, appFolders, appRouter, unknownFolders } = config;
  if (!folders.app) return;
  const appRel = `${srcDir}/${folders.app}`;

  if (config.router && appRouter && !(await exists(path.join(root, appRel, appRouter)))) {
    issues.push({
      severity: 'warning',
      code: 'app-router-missing',
      path: appRel,
      message: `A router is configured, but ${appRel}/${appRouter} does not exist.`,
      hint: `Create ${appRel}/${appRouter} with the app's routes (mounting each feature's routes), or set "appRouter" in ${CONFIG_FILE}.`,
    });
  }

  if (unknownFolders === 'allow') return;
  // The folder holding the router file, e.g. "routing" for "routing/router.tsx", is allowed too.
  const knownNames = [...Object.values(appFolders), ...(appRouter?.includes('/') ? [appRouter.split('/')[0]!] : [])];
  for (const entry of (await readDir(path.join(root, appRel))) ?? []) {
    if (!entry.isDirectory() || knownNames.includes(entry.name)) continue;
    issues.push(
      unknownFolderIssue(
        unknownFolders === 'error' ? 'error' : 'warning',
        `${appRel}/${entry.name}`,
        `Unknown folder "${entry.name}" in ${appRel}/.`,
        'appFolders',
        entry.name,
        knownNames,
      ),
    );
  }
}

/** Checks each feature folder and returns the features that have a public API file. */
async function checkFeatures(root: string, config: ResolvedConfig, issues: Issue[]): Promise<{ all: string[]; withPublicApi: Set<string> }> {
  const { srcDir, folders, featureFolders, featureNaming, unknownFolders, featurePublicApi, featureRoutes } = config;
  const featuresRel = `${srcDir}/${folders.features}`;
  const result = { all: [] as string[], withPublicApi: new Set<string>() };
  const entries = await readDir(path.join(root, featuresRel));
  if (!entries) return result;

  // Folders holding the feature files, e.g. "routes" for "routes/index.tsx", are allowed too.
  const fileFolders = [featurePublicApi, featureRoutes].filter((file) => file?.includes('/')).map((file) => file!.split('/')[0]!);
  const knownNames = [...Object.values(featureFolders), ...fileFolders];

  for (const entry of entries) {
    const entryRel = `${featuresRel}/${entry.name}`;

    if (!entry.isDirectory()) {
      issues.push({
        severity: 'error',
        code: 'unexpected-file',
        path: entryRel,
        message: `"${entry.name}" is a file, but ${featuresRel}/ may only contain feature folders.`,
        hint: 'Move it into a feature folder or into a shared folder.',
      });
      continue;
    }
    result.all.push(entry.name);

    if (!matchesNaming(entry.name, featureNaming)) {
      issues.push({
        severity: 'error',
        code: 'feature-naming',
        path: entryRel,
        message: `Feature "${entry.name}" does not follow ${featureNaming}.`,
        hint: `Rename it to "${toNaming(entry.name, featureNaming)}", or change "featureNaming" in ${CONFIG_FILE}.`,
      });
    }

    // A missing public API file is reported after the import scan, which tells whether the feature is used.
    if (featurePublicApi && (await exists(path.join(root, entryRel, featurePublicApi)))) {
      result.withPublicApi.add(entry.name);
    }

    if (config.router && featureRoutes && !(await exists(path.join(root, entryRel, featureRoutes)))) {
      issues.push({
        severity: 'warning',
        code: 'feature-routes-missing',
        path: entryRel,
        message: `Feature "${entry.name}" has no routes file ${featureRoutes}.`,
        hint: `Add ${entryRel}/${featureRoutes} exporting the feature's routes. Features without pages can ignore this warning.`,
      });
    }

    if (unknownFolders === 'allow') continue;
    for (const child of (await readDir(path.join(root, entryRel))) ?? []) {
      if (!child.isDirectory() || knownNames.includes(child.name)) continue;
      issues.push(
        unknownFolderIssue(
          unknownFolders === 'error' ? 'error' : 'warning',
          `${entryRel}/${child.name}`,
          `Unknown folder "${child.name}" in feature "${entry.name}".`,
          'featureFolders',
          child.name,
          knownNames,
        ),
      );
    }
  }
  return result;
}

/** Validates the project at `root` against its config. Never modifies files. */
export async function checkStructure(root: string): Promise<CheckResult> {
  const { found, config, issues } = await loadConfig(root);
  if (!config) return { root, configFound: found, issues };

  const srcEntries = await readDir(path.join(root, config.srcDir));
  if (!srcEntries) {
    issues.push(srcMissingIssue(config));
    return { root, configFound: found, issues };
  }

  checkSrcRoot(config, srcEntries, issues);
  await checkAppFolder(root, config, issues);
  const features = await checkFeatures(root, config, issues);
  await checkViews(root, config, features.all, issues);
  await checkComponents(root, config, features.all, issues);
  await checkLayouts(root, config, issues);
  issues.push(...(await checkCodeFolders(root, config)));
  // One name, one component: what the project imports by name is never ambiguous.
  const byName = new Map<string, string[]>();
  for (const { name, folderRel } of await projectComponents(root, config)) byName.set(name, [...(byName.get(name) ?? []), folderRel]);
  for (const [name, folderRels] of byName) {
    if (folderRels.length < 2) continue;
    issues.push({
      severity: 'error',
      code: 'component-name-taken',
      path: folderRels[1]!,
      message: `"${name}" is the name of ${folderRels.length} components: ${folderRels.join(', ')}.`,
      hint: 'Component names are unique in the project: rename all but one, e.g. with a name that says where it is used.',
    });
  }
  issues.push(...(await checkRouteTargets(root, config)));
  issues.push(...(await checkRouter(root, config)));
  issues.push(...(await checkConstantsFiles(root, config, (fileRel) => readFile(path.join(root, fileRel), 'utf8').catch(() => undefined))));
  await checkIconLibraries(root, config, issues);
  const { used, graph } = await checkImports(root, config, issues);

  for (const feature of features.all) {
    const featureRel = `${config.srcDir}/${config.folders.features}/${feature}`;
    if (config.featurePublicApi && !features.withPublicApi.has(feature)) {
      const consequence = used.has(feature)
        ? 'other code can only reach it through deep imports'
        : 'so it is unused: nothing outside the feature can import it';
      issues.push({
        severity: 'warning',
        code: 'feature-public-api-missing',
        path: featureRel,
        message: `Feature "${feature}" has no public API file ${config.featurePublicApi}, ${consequence}.`,
        hint: `Add ${featureRel}/${config.featurePublicApi} and export what other code may use.`,
      });
      continue;
    }
    if (used.has(feature)) continue;
    issues.push({
      severity: 'warning',
      code: 'feature-unused',
      path: featureRel,
      message: `Feature "${feature}" is unused: nothing outside it imports "${publicImport(config, feature)}".`,
      hint: 'Use it (e.g. add its routes to the app router) or remove it.',
    });
  }
  issues.push(...(await checkAliasSetup(root, config)));
  issues.push(...(await checkUnused(root, config)));

  for (const loop of findFeatureCycles(graph)) {
    issues.push({
      severity: 'warning',
      code: 'feature-cycle',
      path: `${config.srcDir}/${config.folders.features}`,
      message: `Features import each other in a loop: ${loop.join(' → ')}.`,
      hint: 'Move what they share into a shared folder or a separate feature, merge them, or pass it in (e.g. as props) so only one side imports the other.',
    });
  }
  return { root, configFound: found, issues };
}
