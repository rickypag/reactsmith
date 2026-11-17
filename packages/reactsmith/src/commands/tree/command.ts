import { defineCommand } from '../../core/command.js';
import { requireConfig } from '../../shared/config/load.js';
import { describeFile, outlineElements } from '../../shared/elements/describe.js';
import { IssueError } from '../../shared/issues.js';

export const treeCommand = defineCommand({
  name: 'tree',
  description: 'Describe the elements of a component, view or layout file: their ids, tags, texts, props and styles (with --json, as data to compare)',
  args: [{ name: 'file', description: 'The file: "app/components/TopBar/TopBar.tsx", from the source folder or the project root', required: true }],
  options: {},

  async run({ cwd, args }) {
    try {
      const config = await requireConfig(cwd);
      const description = await describeFile(cwd, config, args.file);
      return { ok: true, summary: [description.file, ...outlineElements(description.roots)].join('\n'), data: { ...description } };
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, issues: error.issues };
    }
  },
});
