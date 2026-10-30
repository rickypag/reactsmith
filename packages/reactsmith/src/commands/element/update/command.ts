import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementUpdate } from '../../../shared/elements/update.js';
import { IssueError } from '../../../shared/issues.js';
import { DRY_RUN, PROPS, TEXT } from '../../../shared/options.js';

export const elementUpdateCommand = defineCommand({
  name: 'element update',
  description: "Update an element's text or props (set or remove), which can use variables of the file such as props",
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    text: TEXT,
    props: PROPS,
    'remove-props': { type: 'string', placeholder: 'names', description: 'Props to remove, by name, e.g. "label elevated"; "children" empties the element' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const config = await requireConfig(cwd);
      updated = await planElementUpdate(changes, config, { target: args.target, text: options.text, props: options.props, removeProps: options.removeProps });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: updated.warnings, summary: `Updated <${updated.tag}> in ${updated.file}.`, data: { id: updated.id, tag: updated.tag, file: updated.file } };
  },
});
