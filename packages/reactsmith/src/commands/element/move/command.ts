import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planElementMove } from '../../../shared/elements/move.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { DRY_RUN, INTO_REQUIRED, POSITION, THROUGH } from '../../../shared/options.js';

export const elementMoveCommand = defineCommand({
  name: 'element move',
  description: 'Move an element, with everything inside it, to another place of the same file; its name, style, props, text and logic stay as they are',
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    into: INTO_REQUIRED,
    position: POSITION,
    through: THROUGH,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let moved;
    try {
      const config = await requireConfig(cwd);
      moved = await planElementMove(changes, config, { target: args.target, into: options.into, position: options.position ?? 'inside', through: options.through });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Moved it in ${moved.file}${moved.id ? `: ${moved.id}` : ''}.`, data: { ...moved } };
  },
});
