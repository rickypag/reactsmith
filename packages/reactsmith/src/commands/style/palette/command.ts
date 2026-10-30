import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { planPaletteImport } from '../../../shared/styles/global.js';
import { PALETTE_ROLES, parseColor, planPalette, type PaletteChanges, type PaletteRole } from '../../../shared/styles/palette.js';
import { DRY_RUN } from '../../../shared/options.js';

const color = (description: string) => ({ type: 'string', placeholder: 'color', description }) as const;

export const stylePaletteCommand = defineCommand({
  name: 'style palette',
  description: 'Set the colors of the app: only the given ones change, and their variants are derived from them',
  options: {
    primary: color('The main brand color, e.g. "#2563eb"'),
    'primary-dark': color('The primary color in dark mode (default: the same)'),
    secondary: color('The second brand color'),
    'secondary-dark': color('The secondary color in dark mode (default: the same)'),
    neutral: color('The gray the backgrounds, borders and text derive from, in light and dark mode'),
    success: color('The color of success states'),
    'success-dark': color('The success color in dark mode'),
    warning: color('The color of warnings'),
    'warning-dark': color('The warning color in dark mode'),
    danger: color('The color of errors and destructive actions'),
    'danger-dark': color('The danger color in dark mode'),
    info: color('The color of information'),
    'info-dark': color('The info color in dark mode'),
    force: { type: 'boolean', description: 'Rewrite the palette file even if it was changed by hand, losing those changes' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, options }) {
    const changes = new ChangeSet(cwd);
    let changed;
    try {
      // Each role's color, and its dark mode color. The neutral has none: its dark shades are derived.
      const given: Record<PaletteRole, [string | undefined, string | undefined]> = {
        primary: [options.primary, options.primaryDark],
        secondary: [options.secondary, options.secondaryDark],
        neutral: [options.neutral, undefined],
        success: [options.success, options.successDark],
        warning: [options.warning, options.warningDark],
        danger: [options.danger, options.dangerDark],
        info: [options.info, options.infoDark],
      };
      const updates: PaletteChanges = {};
      for (const role of PALETTE_ROLES) {
        const [light, dark] = given[role];
        if (light === undefined && dark === undefined) continue;
        updates[role] = {
          ...(light !== undefined ? { light: parseColor(light, `--${role}`) } : {}),
          ...(dark !== undefined ? { dark: parseColor(dark, `--${role}-dark`) } : {}),
        };
      }
      if (Object.keys(updates).length === 0) {
        throw new IssueError({
          severity: 'error',
          code: 'palette-nothing',
          message: 'No color given.',
          hint: 'Pass at least one color, e.g. --primary "#2563eb" --secondary "#7c3aed" --neutral "#64748b".',
        });
      }
      const config = await requireConfig(cwd);
      changed = await planPalette(changes, config, updates, options.force);
      await planPaletteImport(changes, config);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    const summary = changed.length ? `Palette updated: ${changed.join(', ')}.` : 'The palette already has these colors.';
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary, data: { changed } };
  },
});
