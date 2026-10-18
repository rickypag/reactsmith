import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentRemove } from '../../../shared/components/remove.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';

export const componentRemoveCommand = defineCommand({
  name: 'component remove',
  description: 'Remove a component from the layout it is used in (its files are kept)',
  args: [{ name: 'target', description: 'The usage to remove: an element id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
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
    return {
      ok: true,
      dryRun: options.dryRun,
      actions: changes.actions,
      issues: [],
      summary: `Removed "${removed.component}" from ${removed.file}.`,
      data: { ...removed },
    };
  },
});
