import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { isNext } from '../framework/detect.js';
import { relativeImport } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { matchesNaming, toCamelCase, toNaming } from '../naming.js';
import { findExportedRoutesName } from '../routes/add.js';
import { renderTemplate } from '../templates/render.js';

export interface FeatureCreateResult {
  /** Project-relative folder of the feature. */
  featureRel: string;
  /** True when the feature was already there: nothing was planned for its files. */
  existed: boolean;
  /** Project-relative routes file, when the feature has (or gets) one. */
  routesRel?: string;
  /** Name of the routes array exported by the routes file. Undefined when it cannot be found. */
  routesName?: string;
}

function featureError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The routes file and array of an existing feature, if it has them. Its files are not changed. */
async function existingFeature(changes: ChangeSet, config: ResolvedConfig, featureRel: string): Promise<FeatureCreateResult> {
  changes.skip(featureRel, 'feature already exists');
  if (!config.router || !config.featureRoutes) return { featureRel, existed: true };

  const routesRel = `${featureRel}/${config.featureRoutes}`;
  const text = await changes.read(routesRel);
  if (text === undefined) return { featureRel, existed: true };
  return { featureRel, existed: true, routesRel, routesName: findExportedRoutesName(text, path.posix.basename(routesRel)) };
}

/**
 * Plans a new feature: its public API file and, when a router is configured, an empty routes file.
 * When the feature already exists, nothing is planned for it: its files are left as they are.
 */
export async function planFeatureCreate(changes: ChangeSet, config: ResolvedConfig, name: string): Promise<FeatureCreateResult> {
  const featureRel = `${config.srcDir}/${config.folders.features}/${name}`;

  if (!matchesNaming(name, config.featureNaming)) {
    const suggestion = toNaming(name, config.featureNaming);
    throw featureError(
      'feature-name-invalid',
      `Feature name "${name}" does not follow ${config.featureNaming}.`,
      suggestion ? `Use "${suggestion}" instead.` : `Use a ${config.featureNaming} name, e.g. "user-profile".`,
    );
  }
  if (await stat(changes.resolve(featureRel)).catch(() => undefined)) return existingFeature(changes, config, featureRel);

  const { router, featureRoutes, featurePublicApi } = config;
  const routesRel = router && featureRoutes ? `${featureRel}/${featureRoutes}` : undefined;
  const routesName = routesRel ? `${toCamelCase(name)}Routes` : undefined;

  if (featurePublicApi) {
    const apiRel = `${featureRel}/${featurePublicApi}`;
    const barrel = routesRel
      ? await renderTemplate('feature/index-with-routes.ts', { routesName: routesName!, routesImport: relativeImport(apiRel, routesRel) })
      : await renderTemplate('feature/index.ts', { featureName: name });
    changes.write(apiRel, barrel, { type: 'create', message: 'public API' });
  }

  if (routesRel) {
    const routes = await renderTemplate(`react-router/${router!.mode}/routes.tsx`, { routesName: routesName! });
    changes.write(routesRel, routes, { type: 'create', message: 'routes (empty)' });
  } else if (!router) {
    changes.skip(featureRel, isNext(config) ? 'Next.js routes the pages, so no routes file' : 'no router configured, so no routes file');
  }

  return { featureRel, existed: false, routesRel, routesName };
}
