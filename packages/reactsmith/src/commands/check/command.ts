import { defineCommand } from '../../core/command.js';
import { CONFIG_FILE } from '../../shared/config/defaults.js';
import { hasErrors } from '../../shared/issues.js';
import { checkStructure } from '../../shared/structure/check.js';

export const checkCommand = defineCommand({
  name: 'check',
  description: `Validate the project structure against ${CONFIG_FILE}`,
  options: {},

  async run({ cwd }) {
    const { configFound, issues } = await checkStructure(cwd);
    return {
      ok: !hasErrors(issues),
      issues,
      summary: 'Project structure is valid.',
      data: { configFound },
    };
  },
});
