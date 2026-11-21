import { defineCommand } from '../../core/command.js';
import { APP_FILES_LOCATIONS, STYLE_LIBRARIES } from '../../shared/config/defaults.js';
import { runInit } from './init.js';
import { DRY_RUN } from '../../shared/options.js';

export const initCommand = defineCommand({
  name: 'init',
  description: 'Set up the project: config, App files, import alias, the skill for Claude Code, then check',
  options: {
    'app-files': {
      type: 'string',
      values: APP_FILES_LOCATIONS,
      description: 'Move App.* into the app folder, or keep them in the source root',
    },
    styles: {
      type: 'string',
      values: STYLE_LIBRARIES,
      description: 'How the commands write styles: CSS Modules (Name.module.css, the default) or Tailwind classes (Name.styles.ts); asked when Tailwind is installed',
    },
    yes: { type: 'boolean', short: 'y', description: 'Use the defaults instead of asking' },
    'no-skills': { type: 'boolean', description: 'Leave out the ReactSmith skill for Claude Code (.claude/skills/reactsmith) and its block in CLAUDE.md; run init again without it to add them later' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, options, confirm }) {
    const result = await runInit(cwd, {
      appFiles: options.appFiles,
      yes: options.yes,
      dryRun: options.dryRun,
      noSkills: options.noSkills,
      styles: options.styles,
      confirm: options.yes ? undefined : confirm,
    });
    return { ...result, summary: 'Project is set up and valid.' };
  },
});
