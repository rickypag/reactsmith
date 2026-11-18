import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { findFeatureMount, normalizeViewPath } from '../../../shared/routes/app-router.js';
import { viewNameFor } from '../../../shared/views/create.js';
import { defaultRoutePath, featureViewExists, featureViewRel, linksTo, planFeatureViewCreate, planFeatureViewRoute, planNextFeatureViewCreate, nextPagePath } from '../../../shared/views/feature-view.js';
import { NEXT_APP_FOLDER } from '../../../shared/config/defaults.js';
import { isNext } from '../../../shared/framework/detect.js';
import { DRY_RUN, FEATURE_REQUIRED, ROUTE_PATH } from '../../../shared/options.js';

export const viewCreateCommand = defineCommand({
  name: 'view create',
  description:
    "Create a view in a feature and add its route to the feature's routes. " +
    'Safe to run again: for an existing view, --index or --path moves its route, and nothing else changes',
  args: [{ name: 'name', description: 'View name; the view suffix ("viewSuffix" in the config, View by default) is added when missing: "Settings" and "SettingsView" both create SettingsView', required: true }],
  options: {
    feature: FEATURE_REQUIRED,
    path: ROUTE_PATH,
    index: { type: 'boolean', description: "Make the view the feature's index route" },
    loader: { type: 'boolean', description: 'Also create a loader that loads data with the page' },
    empty: { type: 'boolean', description: 'Create the view with only its root, without the placeholder heading: for a view you fill right away' },
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

      // Next.js routes the pages: the view is created and exported, and a page of src/app renders it.
      if (isNext(config)) {
        const routeOption = options.index ? '--index' : options.path !== undefined ? '--path' : options.loader ? '--loader' : undefined;
        if (routeOption) {
          throw new IssueError({
            severity: 'error',
            code: 'next-routes-pages',
            message: `${routeOption} is for React Router: in a Next.js app, Next routes the pages.`,
            hint: `Leave out ${routeOption}, then render the view from a page of ${config.srcDir}/${NEXT_APP_FOLDER}/, which also loads its data.`,
          });
        }
        if (await featureViewExists(changes, config, options.feature, viewName)) {
          throw new IssueError({ severity: 'error', code: 'view-exists', path: featureViewRel(config, options.feature, viewName), message: `View "${viewName}" already exists.`, hint: 'Choose another name.' });
        }
        const from = await planNextFeatureViewCreate(changes, config, options.feature, viewName, options.empty);
        if (!options.dryRun) await changes.apply();
        const page = await nextPagePath(changes, config, options.feature, viewName);
        return {
          ok: true,
          dryRun: options.dryRun,
          actions: changes.actions,
          issues: [],
          summary: `View "${viewName}" created in feature "${options.feature}". Render it from a page, e.g. ${page}: import { ${viewName} } from '${from}'; export default function Page() { return <${viewName} />; }`,
        };
      }

      // An existing view: running it again with --index or --path moves its route; nothing else changes.
      if (await featureViewExists(changes, config, options.feature, viewName)) {
        if (options.loader) {
          throw new IssueError({ severity: 'error', code: 'view-exists', message: `View "${viewName}" already exists: --loader only comes with a new view.`, hint: 'Add the loader to the view by hand, or leave out --loader to move its route.' });
        }
        if (options.empty) {
          throw new IssueError({ severity: 'error', code: 'view-exists', message: `View "${viewName}" already exists: --empty only comes with a new view.`, hint: `Remove its heading with "element remove", or leave out --empty to move its route.` });
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
        empty: options.empty,
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
