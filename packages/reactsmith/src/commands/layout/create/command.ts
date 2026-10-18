import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError, type Issue } from '../../../shared/issues.js';
import { planLayoutCreate } from '../../../shared/layouts/create.js';

export const layoutCreateCommand = defineCommand({
  name: 'layout create',
  description: 'Create the root layout that every page renders in, optionally with a top bar and a sidebar',
  options: {
    topbar: { type: 'boolean', description: 'Add a top bar (the TopBar app component)' },
    sidebar: { type: 'boolean', description: 'Add a sidebar (the Sidebar app component)' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, options }) {
    const changes = new ChangeSet(cwd);
    let warnings: Issue[];
    try {
      const config = await requireConfig(cwd);
      warnings = await planLayoutCreate(changes, config, { topbar: options.topbar, sidebar: options.sidebar });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: warnings, summary: 'Root layout created.' };
  },
});
