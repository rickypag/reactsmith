import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { planComponentUpdate } from '../../../shared/components/update.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';

export const componentUpdateCommand = defineCommand({
  name: 'component update',
  description: 'Update a component: rename it, or change its props (interface), updating its files and every usage',
  args: [{ name: 'target', description: 'The component: its name, e.g. "Card", or its folder, e.g. "src/components/cards/Card"', required: true }],
  options: {
    name: { type: 'string', placeholder: 'name', description: 'A new name: renames the folder, the files, the code and every usage' },
    interface: { type: 'string', placeholder: 'members', description: 'Props to add, or to change when they exist, e.g. "size?: \'sm\' | \'lg\'"' },
    'remove-interface': { type: 'string', placeholder: 'names', description: 'Props to remove, e.g. "elevated": refused while the component or a usage still uses them' },
    'rename-interface': { type: 'string', placeholder: 'old=new', description: 'Props to rename in the interface, the component and every usage, e.g. "label=title"' },
    default: { type: 'string', placeholder: 'value', description: "The value existing usages get for a new required prop, as in JSX, e.g. \"'md'\"" },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const config = await requireConfig(cwd);
      updated = await planComponentUpdate(changes, config, {
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
