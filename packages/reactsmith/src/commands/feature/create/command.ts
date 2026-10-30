import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planFeatureCreate } from '../../../shared/features/create.js';
import { IssueError } from '../../../shared/issues.js';
import { appRouterPath, findFeatureMount, normalizeMountPath, planFeatureLayoutMount, planFeatureMount } from '../../../shared/routes/app-router.js';
import { DRY_RUN, ROUTE_PATH } from '../../../shared/options.js';

export const featureCreateCommand = defineCommand({
  name: 'feature create',
  description:
    'Create a feature: its public API and, with a router, an empty routes file mounted in the app router. ' +
    'Safe to run again: an existing feature is only mounted if it is not yet',
  args: [{ name: 'name', description: 'Feature name, e.g. "user-profile"', required: true }],
  options: {
    path: ROUTE_PATH,
    'no-mount': { type: 'boolean', description: 'Do not add the feature to the app router' },
    layout: { type: 'string', placeholder: 'name', description: 'Mount it inside this app layout, e.g. "DocsLayout": features under one layout share its route; a mounted feature moves there' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options, ask }) {
    const { name } = args;
    const changes = new ChangeSet(cwd);
    let summary: string;
    try {
      const config = await requireConfig(cwd);
      if (options.layout !== undefined && options.noMount) {
        throw new IssueError({ severity: 'error', code: 'options-conflict', message: '--layout mounts the feature: it cannot be used with --no-mount.', hint: 'Leave out one of them.' });
      }
      const feature = await planFeatureCreate(changes, config, name);
      summary = feature.existed ? `Feature "${name}" already exists; nothing changed.` : `Feature "${name}" created.`;

      if (feature.routesName && options.layout !== undefined) {
        // Inside a layout: at the path given, where it is mounted now, or the one asked for.
        const mountedAt = await findFeatureMount(changes, config, feature.routesName);
        const answer = options.path ?? mountedAt ?? (ask ? await ask(`Base route path for "${name}"?`, name) : name);
        const at = await planFeatureLayoutMount(changes, config, name, feature.routesName, normalizeMountPath(answer), options.layout);
        if (at !== undefined) summary = `${feature.existed ? `Feature "${name}" already existed;` : `Feature "${name}" created and`} mounted at ${at} inside ${options.layout}.`;
      } else if (feature.routesRel && !feature.routesName) {
        changes.todo(feature.routesRel, 'mount the feature by hand: no exported routes array was found in this file');
      } else if (feature.routesName && !options.noMount) {
        const mountedAt = await findFeatureMount(changes, config, feature.routesName);
        if (mountedAt !== undefined) {
          changes.skip(appRouterPath(config)!, `${feature.routesName} already mounted at ${mountedAt}`);
        } else {
          const answer = options.path ?? (ask ? await ask(`Base route path for "${name}"?`, name) : name);
          const routePath = normalizeMountPath(answer);
          if (await planFeatureMount(changes, config, name, feature.routesName, routePath)) {
            summary = feature.existed
              ? `Feature "${name}" already existed; mounted at /${routePath}.`
              : `Feature "${name}" created and mounted at /${routePath}.`;
          }
        }
      } else if (feature.routesName && !feature.existed) {
        summary += ` Mount ${feature.routesName} in ${appRouterPath(config) ?? 'your app routes'} when it is ready.`;
      }
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary };
  },
});
