import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { constantOwner, planConstantUpdate } from '../../../shared/constants/plan.js';
import { IssueError } from '../../../shared/issues.js';

export const constantUpdateCommand = defineCommand({
  name: 'constant update',
  description: 'Replace the value of a constant with new plain data (JSON)',
  args: [{ name: 'name', description: 'The constant, e.g. "NAVIGATION"', required: true }],
  options: {
    app: { type: 'boolean', description: 'In the app constants' },
    feature: { type: 'string', placeholder: 'name', description: 'In the constants of a feature' },
    component: { type: 'string', placeholder: 'folder', description: 'In the constants of one component, e.g. app/components/Sidebar' },
    value: { type: 'string', placeholder: 'json', description: 'The value as JSON, e.g. 20, \'"Docs"\' or \'[{"label":"Home","href":"/"}]\'' },
    file: { type: 'string', placeholder: 'path', description: 'A JSON file with the value, e.g. navigation.json' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const owner = constantOwner(options);
      const config = await requireConfig(cwd);
      updated = await planConstantUpdate(changes, config, owner, args.name, { value: options.value, file: options.file });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Constant "${updated.name}" updated in ${updated.file}.`, data: { ...updated } };
  },
});
