import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { INSERT_POSITIONS, planComponentInsert } from '../../../shared/components/insert.js';
import { ownerFromOptions } from '../../../shared/components/scope.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { toPascalCase } from '../../../shared/naming.js';

export const componentInsertCommand = defineCommand({
  name: 'component insert',
  description: 'Insert a component of a feature or of the app into a layout element',
  args: [{ name: 'name', description: 'Component name, e.g. "UserCard"', required: true }],
  options: {
    feature: { type: 'string', placeholder: 'name', description: 'The feature the component belongs to' },
    app: { type: 'boolean', description: 'Insert an app component, into a file of the app folder' },
    into: {
      type: 'string',
      placeholder: 'target',
      description: 'The element: an id, or "path/to/File.tsx:line[:column]"',
      required: true,
    },
    position: {
      type: 'string',
      values: INSERT_POSITIONS,
      description: 'Last child (inside, the default), first child, or a sibling before or after the element',
    },
    props: { type: 'string', placeholder: 'attributes', description: 'JSX attributes for the component, e.g. \'title="Docs" items={[]}\'' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, args, options }) {
    const changes = new ChangeSet(cwd);
    const name = toPascalCase(args.name);
    let inserted;
    try {
      const config = await requireConfig(cwd);
      inserted = await planComponentInsert(changes, config, {
        owner: ownerFromOptions(options.feature, options.app),
        name,
        target: options.into,
        position: options.position ?? 'inside',
        props: options.props,
      });
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    return {
      ok: true,
      dryRun: options.dryRun,
      actions: changes.actions,
      issues: [],
      summary: `Inserted "${name}" into ${inserted.file}.`,
      data: { ...inserted },
    };
  },
});
