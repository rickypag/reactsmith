import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { constantOwner, planConstantCreate } from '../../../shared/constants/plan.js';
import { IssueError } from '../../../shared/issues.js';
import { APP, COMPONENT, DRY_RUN, FEATURE, VALUE, VALUE_FILE } from '../../../shared/options.js';

export const constantCreateCommand = defineCommand({
  name: 'constant create',
  description: "Create a constant holding plain data (JSON) in the app's, a feature's or a component's constants.ts",
  args: [{ name: 'name', description: 'Constant name, unique in the project, e.g. "NAVIGATION"', required: true }],
  options: {
    app: APP,
    feature: FEATURE,
    component: COMPONENT,
    value: VALUE,
    file: VALUE_FILE,
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let created;
    try {
      const owner = constantOwner(options);
      const config = await requireConfig(cwd);
      created = await planConstantCreate(changes, config, owner, args.name, { value: options.value, file: options.file });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Constant "${created.name}" created in ${created.file}.`, data: { ...created } };
  },
});
