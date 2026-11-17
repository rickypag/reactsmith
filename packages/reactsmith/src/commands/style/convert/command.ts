import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { DRY_RUN } from '../../../shared/options.js';
import { planConvertToCssModules } from '../../../shared/styles/convert.js';

export const styleConvertCommand = defineCommand({
  name: 'style convert',
  description: 'Convert the styles of a Tailwind project to CSS Modules: each Name.styles.ts becomes Name.module.css, with its imports, the config and the token files',
  options: {
    to: { type: 'string', values: ['css-modules'], required: true, description: 'What to convert to: css-modules' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, options }) {
    const changes = new ChangeSet(cwd);
    let result;
    try {
      const config = await requireConfig(cwd);
      result = await planConvertToCssModules(changes, config);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }
    if (!options.dryRun) await changes.apply();
    return {
      ok: true,
      dryRun: options.dryRun,
      actions: changes.actions,
      issues: result.warnings,
      summary: `Converted ${result.files} style file${result.files === 1 ? '' : 's'} to CSS Modules.`,
    };
  },
});
