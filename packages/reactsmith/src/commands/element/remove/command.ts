import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementRemove } from '../../../shared/elements/remove.js';
import { IssueError } from '../../../shared/issues.js';

export const elementRemoveCommand = defineCommand({
  name: 'element remove',
  description: 'Remove an element, with everything inside it, from the layout element holding it',
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let removed;
    try {
      const config = await requireConfig(cwd);
      removed = await planElementRemove(changes, config, args.target);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Removed <${removed.tag}> from ${removed.file}.`, data: { ...removed } };
  },
});
