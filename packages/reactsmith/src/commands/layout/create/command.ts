import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { planLayoutCreate, ROOT_LAYOUT } from '../../../shared/layouts/create.js';
import { DRY_RUN, FEATURE } from '../../../shared/options.js';

export const layoutCreateCommand = defineCommand({
  name: 'layout create',
  description:
    'Create a layout, optionally with a top bar and a sidebar: without a name, the root layout that every page renders in; ' +
    'with a name, a nested layout, which features are mounted into ("feature create --layout"); with --feature, the layout of that feature\'s pages',
  args: [{ name: 'name', description: 'The layout\'s name, e.g. "DocsLayout" (default: RootLayout, or "<Feature>Layout" with --feature)' }],
  options: {
    feature: FEATURE,
    topbar: { type: 'boolean', description: 'Add a top bar (the TopBar component of the layout\'s owner)' },
    sidebar: { type: 'boolean', description: 'Add a sidebar (the Sidebar component of the layout\'s owner)' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let created;
    try {
      const config = await requireConfig(cwd);
      created = await planLayoutCreate(changes, config, { name: args.name, feature: options.feature, topbar: options.topbar, sidebar: options.sidebar });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    if (created.next) {
      // Next.js nests the layouts by route folder: a layout.tsx renders this one around its pages.
      const { layoutFile, import: from } = created.next;
      const { name } = created;
      const isRoot = !options.feature && name === ROOT_LAYOUT;
      const where = isRoot
        ? layoutFile
        : options.feature
          ? `${layoutFile}, the route folder of the feature's pages`
          : `the layout.tsx of the route folder whose pages it wraps (${layoutFile})`;
      const render = isRoot
        ? `<body><${name}>{children}</${name}></body>`
        : `export default function Layout({ children }: { children: React.ReactNode }) { return <${name}>{children}</${name}>; }`;
      const summary = `Layout "${name}" created. Render it in ${where}: import { ${name} } from '${from}'; ${render}`;
      return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: created.warnings, summary, data: { name: created.name, folder: created.folder } };
    }
    const summary = {
      root: 'Root layout created.',
      feature: `Layout "${created.name}" created: the pages of feature "${options.feature}" render inside it.`,
      none: `Layout "${created.name}" created. Mount features in it with "feature create <name> --layout ${created.name}".`,
    }[created.mounted as Exclude<typeof created.mounted, 'next'>];
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: created.warnings, summary, data: { name: created.name, folder: created.folder } };
  },
});
