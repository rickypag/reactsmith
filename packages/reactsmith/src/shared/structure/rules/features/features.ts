import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { exists, readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { publicImport, scanImports } from '../../imports.js';

/**
 * Features: each feature has its public API file, and something outside it uses it. Not this rule's: the folders
 * and files of a feature (folder-structure, file-placement), what imports it and how (imports).
 */
export async function checkFeatures(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const { path: featuresRel } = config.tree.features;
  const features = ((await readDir(path.join(root, featuresRel))) ?? []).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (features.length === 0) return [];
  const { used } = await scanImports(root, config);
  const issues: Issue[] = [];

  for (const feature of features) {
    const featureRel = `${featuresRel}/${feature}`;
    if (config.featurePublicApi && !(await exists(path.join(root, featureRel, config.featurePublicApi)))) {
      // Without a public API, nothing can use the feature the right way: say so, rather than that it is unused.
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
  return issues;
}
