import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentUpdate } from '../../../shared/components/update.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { ownerFromOptions } from '../../../shared/components/scope.js';
import { APP, DRY_RUN, FEATURE, INTERFACE } from '../../../shared/options.js';

export const componentUpdateCommand = defineCommand({
  name: 'component update',
  description: 'Update a component: rename it, move it to another owner (with the components only it uses), or change its props (interface), updating its files and every usage',
  args: [{ name: 'target', description: 'The component: its name, e.g. "Card", or its folder, e.g. "src/components/cards/Card"', required: true }],
  options: {
    name: { type: 'string', placeholder: 'name', description: 'A new name: renames the folder, the files, the code and every usage' },
    interface: INTERFACE,
    'remove-interface': { type: 'string', placeholder: 'names', description: 'Props to remove, e.g. "elevated": refused while the component or a usage still uses them; removing the last one removes the interface' },
    'rename-interface': { type: 'string', placeholder: 'old=new', description: 'Props to rename in the interface, the component and every usage, e.g. "label=title"' },
    default: { type: 'string', placeholder: 'value', description: "The value existing usages get for a new required prop, as in JSX, e.g. \"'md'\"" },
    feature: FEATURE,
    app: APP,
    type: { type: 'string', placeholder: 'type', description: 'Move it to this type of shared components, e.g. buttons: src/components/buttons/<Name>' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const config = await requireConfig(cwd);
      const moving = options.feature !== undefined || options.app || options.type !== undefined;
      updated = await planComponentUpdate(changes, config, {
        moveTo: moving ? ownerFromOptions(options.feature, options.app, options.type) : undefined,
        target: args.target,
        name: options.name,
        interface: options.interface,
        removeInterface: options.removeInterface,
        renameInterface: options.renameInterface,
        default: options.default,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: updated.warnings, summary: `Updated "${updated.name}" in ${updated.folder}.`, data: { name: updated.name, folder: updated.folder } };
  },
});
