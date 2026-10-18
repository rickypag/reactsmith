import { defineCommand } from '../../core/command.js';
import { requireConfig } from '../../shared/config/load.js';
import { resolveTarget } from '../../shared/elements/ids.js';
import { IssueError } from '../../shared/issues.js';

export const idCommand = defineCommand({
  name: 'id',
  description: 'Print the id of the JSX element at a file location, which other commands take as their target',
  args: [{ name: 'target', description: 'A location "path/to/File.tsx:line[:column]", or an id to check', required: true }],
  options: {},

  async run({ cwd, args }) {
    try {
      const config = await requireConfig(cwd);
      const { id, file, element } = await resolveTarget(cwd, config, args.target);
      return {
        ok: true,
        summary: id,
        data: { id, file, tag: element.tag, layout: element.layout, line: element.start.line, column: element.start.column },
      };
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, issues: error.issues };
    }
  },
});
