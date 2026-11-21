import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { constantOwner, planConstantRemove } from '../../../shared/constants/plan.js';
import { IssueError } from '../../../shared/issues.js';
import { APP, COMPONENT, DRY_RUN, FEATURE } from '../../../shared/options.js';

export const constantRemoveCommand = defineCommand({
  name: 'constant remove',
  description: 'Remove a constant that nothing uses; the constants file goes with its last constant',
  args: [{ name: 'name', description: 'The constant, e.g. "NAVIGATION"', required: true }],
  options: {
    app: APP,
    feature: FEATURE,
    component: COMPONENT,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let removed;
    try {
      const owner = constantOwner(options);
      const config = await requireConfig(cwd);
      removed = await planConstantRemove(changes, config, owner, args.name);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Constant "${removed.name}" removed from ${removed.file}.`, data: { ...removed } };
  },
});
