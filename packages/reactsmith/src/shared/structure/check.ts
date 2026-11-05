import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkAliasSetup } from '../alias/check.js';
import { exists } from '../files.js';
import { loadConfig } from '../config/load.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { checkAppFiles } from './rules/app-files/app-files.js';
import { checkFilePlacement } from './rules/file-placement/file-placement.js';
import { checkFolderStructure } from './rules/folder-structure/folder-structure.js';
import { checkRouting } from './rules/routing/routing.js';
import { checkIconLibraries } from '../icons/library.js';
import { checkConstantsFiles } from '../constants/files.js';
import { checkCodeFolders } from './code-folders.js';
import { checkRouteTargets } from './route-targets.js';
import { checkRouter } from './router.js';
import { checkComponentContents } from './components.js';
import { checkApi } from './rules/api/api.js';
import { checkComponents } from './rules/components/components.js';
import { checkLayoutContents } from './layouts.js';
import { checkLayouts } from './rules/layouts/layouts.js';
import { checkRepeatedShell } from './layout-chain.js';
import { findFeatureCycles } from './cycles.js';
import { checkImports, publicImport } from './imports.js';
import { checkViewContents } from './views.js';
import { checkViews } from './rules/views/views.js';
import { checkUnused } from './unused.js';
import { checkTokens } from '../tokens/engine.js';
import { TOKEN_KINDS } from '../tokens/kinds.js';

export interface CheckResult {
  root: string;
  configFound: boolean;
  issues: Issue[];
}

/**
 * The feature folders, and the ones that have a public API file. Loose files in the features folder are the
 * file-placement rule's, the folders inside each feature the folder-structure rule's.
 */
async function listFeatures(root: string, config: ResolvedConfig): Promise<{ all: string[]; withPublicApi: Set<string> }> {
  const { path: featuresRel } = config.tree.features;
  const result = { all: [] as string[], withPublicApi: new Set<string>() };
  const entries = await readdir(path.join(root, featuresRel), { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    result.all.push(entry.name);
    // A missing public API file is reported after the import scan, which tells whether the feature is used.
    if (config.featurePublicApi && (await exists(path.join(root, featuresRel, entry.name, config.featurePublicApi)))) {
      result.withPublicApi.add(entry.name);
    }
  }
  return result;
}

/** Validates the project at `root` against its config. Never modifies files. */
export async function checkStructure(root: string): Promise<CheckResult> {
  const { found, config, issues } = await loadConfig(root);
  if (!config) return { root, configFound: found, issues };

  issues.push(...(await checkFolderStructure(root, config)));
  if (!(await exists(path.join(root, config.srcDir)))) return { root, configFound: found, issues };
  issues.push(...(await checkAppFiles(root, config)));
  issues.push(...(await checkRouting(root, config)));
  issues.push(...(await checkFilePlacement(root, config)));

  const features = await listFeatures(root, config);
  issues.push(...(await checkViews(root, config)));
  await checkViewContents(root, config, issues);
  issues.push(...(await checkComponents(root, config)));
  await checkComponentContents(root, config, issues);
  issues.push(...(await checkLayouts(root, config)));
  await checkLayoutContents(root, config, issues);
  issues.push(...(await checkApi(root, config)));
  issues.push(...(await checkRepeatedShell(root, config)));
  issues.push(...(await checkCodeFolders(root, config)));
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
  for (const kind of TOKEN_KINDS) issues.push(...(await checkTokens(kind, root, config, (fileRel) => readFile(path.join(root, fileRel), 'utf8').catch(() => undefined))));

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
