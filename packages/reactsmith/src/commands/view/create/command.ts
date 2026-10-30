import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { findFeatureMount, normalizeViewPath } from '../../../shared/routes/app-router.js';
import { viewNameFor } from '../../../shared/views/create.js';
import { defaultRoutePath, featureViewExists, featureViewRel, linksTo, planFeatureViewCreate, planFeatureViewRoute } from '../../../shared/views/feature-view.js';
import { DRY_RUN, FEATURE_REQUIRED, ROUTE_PATH } from '../../../shared/options.js';

export const viewCreateCommand = defineCommand({
  name: 'view create',
  description:
    "Create a view in a feature and add its route to the feature's routes. " +
    'Safe to run again: for an existing view, --index or --path moves its route, and nothing else changes',
  args: [{ name: 'name', description: 'View name, e.g. "Settings" or "SettingsView"', required: true }],
  options: {
    feature: FEATURE_REQUIRED,
    path: ROUTE_PATH,
    index: { type: 'boolean', description: "Make the view the feature's index route" },
    loader: { type: 'boolean', description: 'Also create a loader that loads data with the page' },
    'dry-run': DRY_RUN,
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

      // An existing view: running it again with --index or --path moves its route; nothing else changes.
      if (await featureViewExists(changes, config, options.feature, viewName)) {
        if (options.loader) {
          throw new IssueError({ severity: 'error', code: 'view-exists', message: `View "${viewName}" already exists: --loader only comes with a new view.`, hint: 'Add the loader to the view by hand, or leave out --loader to move its route.' });
        }
        if (!options.index && options.path === undefined) {
          changes.skip(featureViewRel(config, options.feature, viewName), 'view already exists');
          if (!options.dryRun) await changes.apply();
          return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `View "${viewName}" already exists; nothing changed. Pass --index or --path to move its route.` };
        }
        const routePath = options.index ? undefined : normalizeViewPath(options.path!);
        const moved = await planFeatureViewRoute(changes, config, { feature: options.feature, viewName, routePath });
        const mountedAt = await findFeatureMount(changes, config, moved.routesName);
        const url = (target: string | undefined) => `/${[mountedAt?.replace(/^\/+/, ''), target].filter(Boolean).join('/')}`;
        const issues = moved.from === undefined || mountedAt === undefined ? [] : await linksTo(changes, config, url(moved.from === '(index)' ? undefined : moved.from), url(routePath));
        if (!options.dryRun) await changes.apply();
        const summary = moved.from === undefined ? `View "${viewName}" is at ${url(routePath)}.` : `View "${viewName}" moved to ${url(routePath)}.`;
        return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues, summary };
      }

      let routePath: string | undefined;
      if (!options.index) {
        const fallback = defaultRoutePath(viewName, config);
        routePath = normalizeViewPath(options.path ?? (ask ? await ask(`Route path for "${viewName}"?`, fallback) : fallback));
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
          : `at ${mountedAt === '/' ? `/${routePath ?? ''}` : [mountedAt, routePath].filter(Boolean).join('/')}`;
      summary = `View "${viewName}" created ${where}.`;
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary };
  },
});
