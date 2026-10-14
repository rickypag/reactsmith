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

/** How other code should import a feature, e.g. "@/features/auth". */
export function publicImport(config: ResolvedConfig, feature: string): string {
  const base = config.featurePublicApi ? withoutExtension(config.featurePublicApi) : 'index';
  const featurePath = `${config.folders.features}/${feature}${base === 'index' ? '' : `/${base}`}`;
  return config.alias ? `${config.alias}/${featurePath}` : `${config.srcDir}/${featurePath}`;
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
  const { featurePublicApi, imports } = config;
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
      const to = locate(toRelative(srcAbs, target.base), config);

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

      if (to.kind !== 'feature' || (from.kind === 'feature' && from.feature === to.feature)) continue;
      used.add(to.feature);
      if (from.kind === 'feature') {
        if (!graph.has(from.feature)) graph.set(from.feature, new Set());
        graph.get(from.feature)!.add(to.feature);
      }

      if (from.kind === 'shared' && !imports.sharedImportFeatures) {
        issues.push({
          severity: 'error',
          code: 'shared-imports-feature',
          path: fileRel,
          message: `Shared folder "${from.folder}" imports "${value}" from feature "${to.feature}".`,
          hint: `Shared code must work without any feature. Move what it needs out of the feature into a shared folder, pass it in (e.g. as props), or set "imports.sharedImportFeatures": true in ${CONFIG_FILE}.`,
        });
        continue;
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
    }
  }
  return { used, graph };
}
