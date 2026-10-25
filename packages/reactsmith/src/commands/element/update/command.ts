import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementUpdate } from '../../../shared/elements/update.js';
import { IssueError } from '../../../shared/issues.js';

export const elementUpdateCommand = defineCommand({
  name: 'element update',
  description: "Update an element's text or props, which can use variables of the file such as props",
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    text: { type: 'string', placeholder: 'text', description: 'The new text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"' },
    props: { type: 'string', placeholder: 'props', description: 'Props to set as JSX attributes, each replacing the one of the same name, e.g. "to={href}"' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let updated;
    try {
      const config = await requireConfig(cwd);
      updated = await planElementUpdate(changes, config, { target: args.target, text: options.text, props: options.props });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Updated <${updated.tag}> in ${updated.file}.`, data: { ...updated } };
  },
});
