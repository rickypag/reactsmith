import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { constantOwner, planConstantUpdate } from '../../../shared/constants/plan.js';
import { IssueError } from '../../../shared/issues.js';
import { APP, COMPONENT, DRY_RUN, FEATURE, VALUE, VALUE_FILE, VALUE_TYPE } from '../../../shared/options.js';

export const constantUpdateCommand = defineCommand({
  name: 'constant update',
  description: 'Replace the value of a constant with new plain data (JSON)',
  args: [{ name: 'name', description: 'The constant, e.g. "NAVIGATION"', required: true }],
  options: {
    app: APP,
    feature: FEATURE,
    component: COMPONENT,
    value: VALUE,
    file: VALUE_FILE,
    type: VALUE_TYPE,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const owner = constantOwner(options);
      const config = await requireConfig(cwd);
      updated = await planConstantUpdate(changes, config, owner, args.name, { value: options.value, file: options.file, type: options.type });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Constant "${updated.name}" updated in ${updated.file}.`, data: { ...updated } };
  },
});
