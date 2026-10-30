import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { findSpecifiers, isCodeFile, specifierPath } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import type { FeatureGraph } from './cycles.js';

/**
 * Where a file or import target sits in the structure:
 * a feature, the app folder, a shared folder (components, hooks, lib...), or elsewhere (e.g. main.tsx).
 */
type Location =
  | { kind: 'feature'; feature: string; inner: string }
  | { kind: 'app' }
  | { kind: 'shared'; folder: string }
  | { kind: 'other' };

function locate(relToSrc: string, config: ResolvedConfig): Location {
  if (relToSrc.startsWith('..')) return { kind: 'other' };
  const [top, feature, ...rest] = relToSrc.split('/');
  if (top === config.folders.features && feature) return { kind: 'feature', feature, inner: rest.join('/') };
  if (config.folders.app && top === config.folders.app) return { kind: 'app' };
  if (feature !== undefined && top && Object.values(config.folders).includes(top)) return { kind: 'shared', folder: top };
  return { kind: 'other' };
}

const TEST_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

/**
 * Tests, stories and the testing folder need to reach everywhere (e.g. render with the app's providers),
 * so they are exempt from the import rules and do not count as using a feature.
 */
function isTestCode(relToSrc: string, config: ResolvedConfig): boolean {
  const testing = config.folders.testing;
  return TEST_FILE.test(relToSrc) || (testing !== undefined && relToSrc.startsWith(`${testing}/`));
}

function withoutExtension(file: string): string {
  return file.replace(/\.(ts|tsx|js|jsx)$/, '');
}

/** Whether an import into a feature ("index", "index.js", or the folder itself) targets its public API. */
function isPublicApi(inner: string, publicApi: string): boolean {
  const base = withoutExtension(publicApi);
  if (inner === publicApi || withoutExtension(inner) === base) return true;
  return inner === '' && base === 'index';
}

/** A component, view or layout: its folder holds its files, and only its entry point is imported from outside. */
interface Unit {
  kind: 'component' | 'view' | 'layout' | CodeFolder;
  /** Its folder, relative to srcDir: "features/docs/components/Sidebar", or "utils" for the shared utils. */
  folder: string;
}

/** The folders of code shared through a barrel, at the top of srcDir and in each feature. */
export const CODE_FOLDERS = ['hooks', 'utils', 'types', 'stores'] as const;
export type CodeFolder = (typeof CODE_FOLDERS)[number];

/** The hooks, utils, types or stores folder a path is in, shared or of a feature, if any. */
function codeFolderOf(relToSrc: string, config: ResolvedConfig): Unit | undefined {
  const parts = relToSrc.split('/');
  const inFeature = parts[0] === config.folders.features;
  const at = inFeature ? 2 : 0;
  const names = inFeature ? config.featureFolders : config.folders;
  const kind = CODE_FOLDERS.find((role) => names[role] !== undefined && names[role] === parts[at]);
  if (!kind || parts.length < at + 2) return undefined;
  return { kind, folder: parts.slice(0, at + 1).join('/') };
}

/** The component, view or layout folder a path is in, or its hooks, utils, types or stores folder, if any. */
function unitOf(relToSrc: string, config: ResolvedConfig): Unit | undefined {
  const parts = relToSrc.split('/');
  const { folders, featureFolders, appFolders } = config;
  // A shared component: components/<type>/<Name>.
  if (folders.components && parts[0] === folders.components && parts.length >= 3) return { kind: 'component', folder: parts.slice(0, 3).join('/') };
  const kinds: [string | undefined, Unit['kind']][] =
    parts[0] === folders.features
      ? [[featureFolders.components, 'component'], [featureFolders.views, 'view'], [featureFolders.layouts, 'layout']]
      : folders.app && parts[0] === folders.app
        ? [[appFolders.components, 'component'], [appFolders.views, 'view'], [appFolders.layouts, 'layout']]
        : [];
  const at = parts[0] === folders.features ? 2 : 1;
  const [folderName, name] = [parts[at], parts[at + 1]];
  const kind = kinds.find(([candidate]) => candidate !== undefined && candidate === folderName)?.[1];
  if (!kind || !name || parts.length < at + 2) return codeFolderOf(relToSrc, config);
  return { kind, folder: parts.slice(0, at + 2).join('/') };
}

/** Whether a file is a routes file: a feature's routes, or the app router. */
function isRoutesFile(relToSrc: string, config: ResolvedConfig): boolean {
  const { folders, featureRoutes, appRouter } = config;
  const parts = relToSrc.split('/');
  if (featureRoutes && parts[0] === folders.features && parts.slice(2).join('/') === featureRoutes) return true;
  return !!(appRouter && folders.app && relToSrc === `${folders.app}/${appRouter}`);
}

/** Whether an import of a unit's folder targets its entry point: the folder itself, or its index. */
function isEntryPoint(relToSrc: string, unit: Unit): boolean {
  const inner = relToSrc.slice(unit.folder.length).replace(/^\//, '');
  return inner === '' || withoutExtension(inner) === 'index';
}

/** How other code should import a feature, e.g. "@/features/auth". */
export function publicImport(config: ResolvedConfig, feature: string): string {
  const base = config.featurePublicApi ? withoutExtension(config.featurePublicApi) : 'index';
  const featurePath = `${config.folders.features}/${feature}${base === 'index' ? '' : `/${base}`}`;
  return config.alias ? `${config.alias}/${featurePath}` : `${config.srcDir}/${featurePath}`;
}

/**
 * The import rules one import breaks: `value`, written in the file at `fileRelToSrc`, imports `targetRelToSrc`
 * (both relative to srcDir). Tests and stories break none.
 */
export function importIssues(config: ResolvedConfig, fileRelToSrc: string, fileRel: string, value: string, targetRelToSrc: string): Issue[] {
  const issues: Issue[] = [];
  if (isTestCode(fileRelToSrc, config)) return issues;
  const { featurePublicApi, imports } = config;
  const from = locate(fileRelToSrc, config);
  const to = locate(targetRelToSrc, config);

  // A component, view or layout is a black box: from outside its folder, only its entry point.
  const unit = unitOf(targetRelToSrc, config);
  if (unit && !`${fileRelToSrc}/`.startsWith(`${unit.folder}/`) && !isEntryPoint(targetRelToSrc, unit)) {
    const name = unit.folder.split('/').pop()!;
    issues.push({
      severity: 'error',
      code: `${unit.kind}-deep-import`,
      path: fileRel,
      message: (CODE_FOLDERS as readonly string[]).includes(unit.kind)
        ? `"${value}" imports from inside the ${unit.folder} folder.`
        : `"${value}" imports from inside ${unit.kind} "${name}".`,
      hint: `Import from its folder (its index.ts) instead, and export what you need there.`,
    });
  } else if (unit?.kind === 'component' && config.folders.components && unit.folder.startsWith(`${config.folders.components}/`)) {
    // From outside its type, a shared component comes from the type's barrel: '@/components/buttons'.
    const typeFolder = unit.folder.split('/').slice(0, 2).join('/');
    if (!fileRelToSrc.startsWith(`${typeFolder}/`)) {
      issues.push({
        severity: 'error',
        code: 'shared-component-import',
        path: fileRel,
        message: `"${value}" imports a shared component past the barrel of its type.`,
        hint: `Import it from "${config.alias ? `${config.alias}/${typeFolder}` : typeFolder}", which offers the components of the type.`,
      });
    }
  }

  // A view is a page: only routes load it, by its folder.
  if (unit?.kind === 'view' && !`${fileRelToSrc}/`.startsWith(`${unit.folder}/`) && !isRoutesFile(fileRelToSrc, config)) {
    issues.push({
      severity: 'error',
      code: 'view-import-outside-routes',
      path: fileRel,
      message: `"${value}" imports the view "${unit.folder.split('/').pop()}": views are only loaded by routes.`,
      hint: 'Move what you want to reuse into a component, and use the component in both places.',
    });
  }
  // A layout wraps routes: only a routes file uses it (a feature's layout, its own routes; through the feature's
  // public API, it would be another feature's or the app's, which the deep-import rule already refuses).
  if (unit?.kind === 'layout' && !`${fileRelToSrc}/`.startsWith(`${unit.folder}/`) && !isRoutesFile(fileRelToSrc, config)) {
    issues.push({
      severity: 'error',
      code: 'layout-import-outside-routes',
      path: fileRel,
      message: `"${value}" imports the layout "${unit.folder.split('/').pop()}": layouts are only used by routes.`,
      hint: 'Move what you want to reuse into a component, and use the component in both places.',
    });
  }

  if (from.kind === 'feature' && to.kind === 'app' && !imports.featuresImportApp) {
    issues.push({
      severity: 'error',
      code: 'feature-imports-app',
      path: fileRel,
      message: `Feature "${from.feature}" imports "${value}" from the app folder.`,
      hint: `The app shell uses features, not the other way round. Move the shared code to a shared folder (e.g. ${config.srcDir}/${config.folders.components}), or set "imports.featuresImportApp": true in ${CONFIG_FILE}.`,
    });
  }
  if (from.kind === 'shared' && to.kind === 'app' && !imports.sharedImportApp) {
    issues.push({
      severity: 'error',
      code: 'shared-imports-app',
      path: fileRel,
      message: `Shared folder "${from.folder}" imports "${value}" from the app folder.`,
      hint: `Shared code must not depend on the app shell. Move the code it needs into a shared folder, or set "imports.sharedImportApp": true in ${CONFIG_FILE}.`,
    });
  }

  if (to.kind !== 'feature' || (from.kind === 'feature' && from.feature === to.feature)) return issues;
  if (from.kind === 'shared' && !imports.sharedImportFeatures) {
    issues.push({
      severity: 'error',
      code: 'shared-imports-feature',
      path: fileRel,
      message: `Shared folder "${from.folder}" imports "${value}" from feature "${to.feature}".`,
      hint: `Shared code must work without any feature. Move what it needs out of the feature into a shared folder, pass it in (e.g. as props), or set "imports.sharedImportFeatures": true in ${CONFIG_FILE}.`,
    });
    return issues;
  }
  if (imports.featurePublicApiOnly && featurePublicApi && !isPublicApi(to.inner, featurePublicApi)) {
    issues.push({
      severity: 'error',
      code: 'feature-deep-import',
      path: fileRel,
      message: `"${value}" imports from inside feature "${to.feature}".`,
      hint: `Import from "${publicImport(config, to.feature)}" instead, and export what you need from its ${featurePublicApi}.`,
    });
  }
  return issues;
}

/**
 * Checks every import in srcDir against the import rules. Dependencies go one way:
 * shared folders → features → app. Code outside a feature only imports its public API.
 * Returns the features imported from outside themselves (to detect unused ones)
 * and which features import which (to detect loops).
 */
export async function checkImports(
  root: string,
  config: ResolvedConfig,
  issues: Issue[],
): Promise<{ used: Set<string>; graph: FeatureGraph }> {
  const srcAbs = path.join(root, config.srcDir);
  const used = new Set<string>();
  const graph: FeatureGraph = new Map();
  const files = (await listFiles(srcAbs)).filter(isCodeFile).sort();

  for (const file of files) {
    const fileRelToSrc = toRelative(srcAbs, file);
    if (isTestCode(fileRelToSrc, config)) continue;
    const from = locate(fileRelToSrc, config);
    const fileRel = toRelative(root, file);

    for (const { value } of findSpecifiers(await readFile(file, 'utf8'))) {
      const target = specifierPath(value, file, srcAbs, config.alias);
      if (!target) continue;
      const targetRelToSrc = toRelative(srcAbs, target.base);
      issues.push(...importIssues(config, fileRelToSrc, fileRel, value, targetRelToSrc));
      const to = locate(targetRelToSrc, config);
      if (to.kind !== 'feature' || (from.kind === 'feature' && from.feature === to.feature)) continue;
      used.add(to.feature);
      if (from.kind === 'feature') {
        if (!graph.has(from.feature)) graph.set(from.feature, new Set());
        graph.get(from.feature)!.add(to.feature);
      }
    }
  }
  return { used, graph };
}
