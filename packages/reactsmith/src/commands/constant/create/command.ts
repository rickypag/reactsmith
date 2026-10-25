import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { constantOwner, planConstantCreate } from '../../../shared/constants/plan.js';
import { IssueError } from '../../../shared/issues.js';

export const constantCreateCommand = defineCommand({
  name: 'constant create',
  description: "Create a constant holding plain data (JSON) in the app's, a feature's or a component's constants.ts",
  args: [{ name: 'name', description: 'Constant name, unique in the project, e.g. "NAVIGATION"', required: true }],
  options: {
    app: { type: 'boolean', description: 'In the app constants, for data the whole app uses' },
    feature: { type: 'string', placeholder: 'name', description: 'In the constants of a feature' },
    component: { type: 'string', placeholder: 'folder', description: 'In the constants of one component, e.g. app/components/Sidebar' },
    value: { type: 'string', placeholder: 'json', description: 'The value as JSON, e.g. 20, \'"Docs"\' or \'[{"label":"Home","href":"/"}]\'' },
    file: { type: 'string', placeholder: 'path', description: 'A JSON file with the value, e.g. navigation.json' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
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
