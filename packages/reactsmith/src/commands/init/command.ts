import { defineCommand } from '../../core/command.js';
import { APP_FILES_LOCATIONS } from '../../shared/config/defaults.js';
import { runInit } from './init.js';

export const initCommand = defineCommand({
  name: 'init',
  description: 'Set up the project: config, App files, import alias, then check',
  options: {
    'app-files': {
      type: 'string',
      values: APP_FILES_LOCATIONS,
      description: 'Move App.* into the app folder, or keep them in the source root',
    },
    yes: { type: 'boolean', short: 'y', description: 'Use the defaults instead of asking' },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything' },
  },

  async run({ cwd, options, confirm }) {
    const result = await runInit(cwd, {
      appFiles: options.appFiles,
      yes: options.yes,
      dryRun: options.dryRun,
      confirm: options.yes ? undefined : confirm,
    });
    return { ...result, summary: 'Project is set up and valid.' };
  },
});
