import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { planElementRemove } from '../../../shared/elements/remove.js';
import { IssueError } from '../../../shared/issues.js';
import { DRY_RUN } from '../../../shared/options.js';

export const elementRemoveCommand = defineCommand({
  name: 'element remove',
  description: 'Remove an HTML element, a component or a list, with everything inside it (or keeping it, to unwrap it); imports and styles nothing else uses go too (component files are kept: see "component remove")',
  args: [{ name: 'target', description: 'The element: an id, or "path/to/File.tsx:line[:column]"', required: true }],
  options: {
    'keep-children': { type: 'boolean', description: 'Remove only the element: its content takes its place (unwrap it), and its style goes when nothing else uses it' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    let removed;
    try {
      const config = await requireConfig(cwd);
      removed = await planElementRemove(changes, config, args.target, options.keepChildren);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary: `Removed ${removed.tag.startsWith('{?') ? `the condition ${removed.tag}` : removed.tag.startsWith('{') ? `the list ${removed.tag}` : `<${removed.tag}>`} from ${removed.file}.`, data: { ...removed } };
  },
});
