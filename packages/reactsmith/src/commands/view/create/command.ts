import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { findFeatureMount, normalizeRoutePath } from '../../../shared/routes/app-router.js';
import { viewNameFor } from '../../../shared/views/create.js';
import { defaultRoutePath, planFeatureViewCreate } from '../../../shared/views/feature-view.js';

export const viewCreateCommand = defineCommand({
  name: 'view create',
  description: "Create a view in a feature and add its route to the feature's routes",
  args: [{ name: 'name', description: 'View name, e.g. "Settings" or "SettingsView"', required: true }],
  options: {
    feature: { type: 'string', placeholder: 'name', description: 'The feature the view belongs to', required: true },
    path: { type: 'string', placeholder: 'path', description: 'Route path inside the feature, e.g. "settings" or ":id" (default: asked, or the view name)' },
    index: { type: 'boolean', description: "Make the view the feature's index route" },
    loader: { type: 'boolean', description: 'Also create a loader that loads data with the page' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options, ask }) {
    const changes = new ChangeSet(cwd);
    let summary: string;
    try {
      if (options.index && options.path !== undefined) {
        throw new IssueError({
          severity: 'error',
          code: 'options-conflict',
          message: '--index and --path cannot be used together.',
          hint: 'An index route has no path of its own: use one or the other.',
        });
      }
      const config = await requireConfig(cwd);
      const viewName = viewNameFor(args.name, config);

      let routePath: string | undefined;
      if (!options.index) {
        const fallback = defaultRoutePath(viewName, config);
        routePath = normalizeRoutePath(options.path ?? (ask ? await ask(`Route path for "${viewName}"?`, fallback) : fallback));
      }

      const { routesName } = await planFeatureViewCreate(changes, config, {
        feature: options.feature,
        viewName,
        routePath,
        loader: options.loader,
      });

      const mountedAt = await findFeatureMount(changes, config, routesName);
      const where =
        mountedAt === undefined
          ? `at "${routePath ?? '(index)'}" in feature "${options.feature}", which is not mounted in the app router yet`
          : `at ${[mountedAt === '/' ? '' : mountedAt, routePath].filter(Boolean).join('/') || '/'}`;
      summary = `View "${viewName}" created ${where}.`;
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary };
  },
});
