import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { INSERT_POSITIONS } from '../../../shared/elements/position.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planIconInsert } from '../../../shared/icons/insert.js';
import { IssueError } from '../../../shared/issues.js';

export const iconInsertCommand = defineCommand({
  name: 'icon insert',
  description: "Insert an icon of the project's icon library into a layout or text element",
  args: [{ name: 'icon', description: 'The icon, as on the library\'s website ("arrow-right") or as a component ("ArrowRight")', required: true }],
  options: {
    into: { type: 'string', placeholder: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true },
    position: { type: 'string', values: INSERT_POSITIONS, description: 'Last child (inside, the default), first child, or a sibling before or after the element' },
    size: { type: 'string', placeholder: 'px', description: "The icon's size in pixels (default: the library's)" },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let inserted;
    try {
      const config = await requireConfig(cwd);
      inserted = await planIconInsert(changes, config, {
        icon: args.icon,
        target: options.into,
        position: options.position ?? 'inside',
        size: options.size === undefined ? undefined : Number(options.size),
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Inserted the icon "${inserted.icon}" into ${inserted.file}.`, data: { ...inserted } };
  },
});
