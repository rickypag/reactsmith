import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE, STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { findSpecifiers, specifierPath } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { API_FOLDER, checkApiFolder, COMPONENT_API_FILES, MUTATIONS_FILE, QUERIES_FILE } from './api.js';
import { componentEntryProblems, componentFileProblems } from './component-file.js';
import { componentStyleIssues } from './component-styles.js';
import { inlineStyleIssues } from './inline-styles.js';
import { plainLinkIssues } from './links.js';
import { listShapeIssues } from './lists.js';
import { textPlacementIssues } from './text.js';

/** The UI of a component that loads data: props in, JSX out. */
export const CONTENT_SUFFIX = 'Content';

/** The placeholder a component that loads data shows while loading. */
export const SKELETON_SUFFIX = 'Skeleton';

/** Files a component folder may hold besides its component files and api/. */
export const COMPONENT_EXTRA_FILES = ['index.ts', 'types.ts', 'utils.ts', 'constants.ts'] as const;

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

/** Tests and stories are the dev's choice: no rules and no commands for them in v1. */
const FREE_FILE = /\.(test|spec|stories)\.[jt]sx?$/;

const COMPONENT_FILE_HINT =
  'A component file holds only the component (an arrow function typed React.FC) and, if needed, its props interface. ' +
  'Move types to types.ts, helpers to utils.ts and constants to constants.ts (with "constant create").';

async function readOptional(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

/** Problems with `fileName`'s content and, for Content and Skeleton, its imports from api/. */
async function checkComponentFile(
  root: string,
  config: ResolvedConfig,
  folderRel: string,
  fileName: string,
  name: string,
  issues: Issue[],
): Promise<void> {
  const fileRel = `${folderRel}/${fileName}`;
  const text = await readOptional(path.join(root, fileRel));
  if (text === undefined) return;
  issues.push(...textPlacementIssues(root, config, fileRel, text), ...listShapeIssues(fileRel, text), ...plainLinkIssues(config, fileRel, text), ...inlineStyleIssues(config, fileRel, text));
  issues.push(...(await componentStyleIssues(root, config, fileRel, text, fileName.replace(/\.[jt]sx$/, ''))));
  for (const problem of componentFileProblems(text, fileName, name)) {
    issues.push({ severity: 'error', code: 'component-file-content', path: fileRel, message: problem, hint: COMPONENT_FILE_HINT });
  }

  if (!name.endsWith(CONTENT_SUFFIX) && !name.endsWith(SKELETON_SUFFIX)) return;
  const file = path.join(root, fileRel);
  const apiDir = path.join(root, folderRel, API_FOLDER);
  for (const specifier of findSpecifiers(text)) {
    const base = specifierPath(specifier.value, file, path.join(root, config.srcDir), config.alias)?.base;
    if (base === undefined || (base !== apiDir && !base.startsWith(apiDir + path.sep))) continue;
    const main = folderRel.split('/').pop()!;
    issues.push({
      severity: 'error',
      code: 'component-content-imports-api',
      path: fileRel,
      message: `${name} imports "${specifier.value}", but only ${main}.tsx may use ${API_FOLDER}/.`,
      hint: `Call the query or mutation in ${main}.tsx and pass the data and callbacks to ${name} as props.`,
    });
  }
}

/** Checks one component folder: allowed files, the component files, the entry point and api/. */
async function checkComponentFolder(root: string, config: ResolvedConfig, folderRel: string, entries: Dirent[], issues: Issue[]): Promise<void> {
  const name = folderRel.split('/').pop()!;
  const contentName = `${name}${CONTENT_SUFFIX}`;
  const skeletonName = `${name}${SKELETON_SUFFIX}`;
  const componentFiles = [name, contentName, skeletonName].map((component) => `${component}.tsx`);
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  // Each component file may have its own style file, in the configured format.
  const styleSuffix = STYLE_FILE_SUFFIXES[config.styles];
  const styleFiles = componentFiles.filter((file) => files.has(file)).map((file) => file.replace(/\.tsx$/, styleSuffix));

  for (const entry of entries) {
    const allowed = entry.isDirectory()
      ? entry.name === API_FOLDER
      : [...componentFiles, ...styleFiles, ...COMPONENT_EXTRA_FILES].includes(entry.name) || FREE_FILE.test(entry.name);
    if (allowed) continue;
    const isStyle = /\.(css|scss|sass|less)$|\.styles\.ts$|\.css\.ts$/.test(entry.name);
    issues.push({
      severity: 'error',
      code: 'component-unexpected-file',
      path: `${folderRel}/${entry.name}`,
      message: `"${entry.name}" is not allowed in component "${name}".`,
      hint: isStyle
        ? `Styles are ${config.styles} ("styles" in ${CONFIG_FILE}): each component file has its own, e.g. ${name}${styleSuffix} for ${name}.tsx.`
        : `A component folder holds ${componentFiles.join(', ')}, their style files, ${COMPONENT_EXTRA_FILES.join(', ')} and an ${API_FOLDER}/ folder, ` +
          'plus tests and stories. Move other code into one of them, or into its own component.',
    });
  }

  if (!files.has(`${name}.tsx`)) {
    issues.push({
      severity: 'error',
      code: 'component-file-missing',
      path: folderRel,
      message: `Component folder "${name}" has no ${name}.tsx.`,
      hint: 'The main component file is named like its folder.',
    });
  }
  for (const component of [name, contentName, skeletonName]) {
    await checkComponentFile(root, config, folderRel, `${component}.tsx`, component, issues);
  }

  const entryRel = `${folderRel}/index.ts`;
  const entryText = await readOptional(path.join(root, entryRel));
  if (entryText === undefined) {
    issues.push({
      severity: 'error',
      code: 'component-entry-missing',
      path: folderRel,
      message: `Component folder "${name}" has no index.ts.`,
      hint: `Add index.ts with "export { ${name} } from './${name}';".`,
    });
  } else {
    for (const problem of componentEntryProblems(entryText, 'index.ts', name)) {
      issues.push({
        severity: 'error',
        code: 'component-entry-invalid',
        path: entryRel,
        message: problem,
        hint: `It should only contain "export { ${name} } from './${name}';" (and the ${name}Props type, if needed).`,
      });
    }
  }

  // A component that loads data splits into the main component (data, loading, errors), Content (UI) and Skeleton (loading).
  const apiRel = `${folderRel}/${API_FOLDER}`;
  const apiFiles = new Set(await readdir(path.join(root, apiRel)).catch(() => [] as string[]));
  const required = [
    ...(apiFiles.has(QUERIES_FILE) || apiFiles.has(MUTATIONS_FILE) ? [{ component: contentName, role: 'the UI, without data access' }] : []),
    ...(apiFiles.has(QUERIES_FILE) ? [{ component: skeletonName, role: 'what is shown while loading' }] : []),
  ];
  for (const { component, role } of required) {
    if (files.has(`${component}.tsx`)) continue;
    const reason = apiFiles.has(QUERIES_FILE) ? `loads data (${API_FOLDER}/${QUERIES_FILE})` : `edits data (${API_FOLDER}/${MUTATIONS_FILE})`;
    issues.push({
      severity: 'error',
      code: 'component-split-missing',
      path: folderRel,
      message: `Component "${name}" ${reason}, so it needs ${component}.tsx: ${role}.`,
      hint: `${name}.tsx handles the data and its states, and renders ${required.map((r) => r.component).join(' or ')}.`,
    });
  }

  await checkApiFolder(root, folderRel, 'component', COMPONENT_API_FILES, issues);
}

/** Checks one components folder: each component in its own PascalCase folder. */
async function checkComponentsFolder(root: string, config: ResolvedConfig, componentsRel: string, issues: Issue[]): Promise<void> {
  const entries = await readdir(path.join(root, componentsRel), { withFileTypes: true }).catch(() => undefined);
  for (const entry of (entries ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
    const entryRel = `${componentsRel}/${entry.name}`;
    if (!entry.isDirectory()) {
      const name = entry.name.replace(/\.[^.]+$/, '');
      issues.push({
        severity: 'error',
        code: 'component-not-in-folder',
        path: entryRel,
        message: `"${entry.name}" is directly in ${componentsRel}/, but each component lives in its own folder.`,
        hint: `Move it to ${componentsRel}/${name}/${entry.name} and add an index.ts exporting it.`,
      });
      continue;
    }
    if (!COMPONENT_NAME.test(entry.name)) {
      issues.push({
        severity: 'error',
        code: 'component-naming',
        path: entryRel,
        message: `Component folder "${entry.name}" is not PascalCase.`,
        hint: 'Name it like the component it holds, e.g. "UserCard".',
      });
      continue;
    }
    const children = await readdir(path.join(root, entryRel), { withFileTypes: true });
    await checkComponentFolder(root, config, entryRel, children.sort((a, b) => a.name.localeCompare(b.name)), issues);
  }
}

/** Checks the components of every feature and of the app. Shared components follow later. */
export async function checkComponents(root: string, config: ResolvedConfig, features: string[], issues: Issue[]): Promise<void> {
  const featureComponents = config.featureFolders.components;
  for (const feature of featureComponents ? features : []) {
    await checkComponentsFolder(root, config, `${config.srcDir}/${config.folders.features}/${feature}/${featureComponents}`, issues);
  }
  if (config.folders.app && config.appFolders.components) {
    await checkComponentsFolder(root, config, `${config.srcDir}/${config.folders.app}/${config.appFolders.components}`, issues);
  }
}
