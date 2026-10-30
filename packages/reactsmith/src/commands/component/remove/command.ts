import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentRemove } from '../../../shared/components/remove.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { DRY_RUN } from '../../../shared/options.js';

export const componentRemoveCommand = defineCommand({
  name: 'component remove',
  description: 'Delete a component that nothing uses, with its folder; a shared component leaves the barrel of its type too',
  args: [{ name: 'target', description: 'The component: its name, e.g. "Card", or its folder, e.g. "src/components/cards/Card"', required: true }],
  options: {
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let removed;
    try {
      const config = await requireConfig(cwd);
      removed = await planComponentRemove(changes, config, args.target);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Removed "${removed.name}" (${removed.folder}).`, data: { ...removed } };
  },
});
