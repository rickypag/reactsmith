import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { planTokenImports } from '../../../shared/styles/global.js';
import { onColor, PALETTE_ROLES, parseColor, type PaletteRole } from '../../../shared/styles/palette.js';
import { COLORS } from '../../../shared/tokens/colors.js';
import { allTokens, findToken, labelIfChanged, planTokens, setAndRemove, setToken, tokenUsages, tokensError, type Tokens } from '../../../shared/tokens/engine.js';
import { DRY_RUN } from '../../../shared/options.js';
import { TOKEN_OPTIONS } from '../tokens.js';

const color = (description: string) => ({ type: 'string', placeholder: 'color', description }) as const;
const PLAIN = /^(#|rgb|hsl)/;

export const stylePaletteCommand = defineCommand({
  name: 'style palette',
  description: 'Set the colors of the app (tokens/colors.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from colors.json',
  options: {
    ...TOKEN_OPTIONS('colors', 'text/default/secondary=#757575; background/brand={brand.800}', 'dark'),
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
    force: { type: 'boolean', description: 'Move an old palette.css changed by hand anyway, losing those changes' },
    'dry-run': DRY_RUN,
  },

  async run({ cwd, options }) {
    const changes = new ChangeSet(cwd);
    let changed: string[];
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
      const roles = PALETTE_ROLES.flatMap((role) => {
        const [light, dark] = given[role];
        if (light === undefined && dark === undefined) return [];
        return [{ role, light: light === undefined ? undefined : parseColor(light, `--${role}`), dark: dark === undefined ? undefined : parseColor(dark, `--${role}-dark`) }];
      });
      const config = await requireConfig(cwd);
      const usages = options.remove ? await tokenUsages(COLORS, (fileRel) => changes.read(fileRel), cwd, config) : new Map<string, string[]>();
      const { edit: setAndRemoveEdit } = setAndRemove(COLORS, options, usages);
      const edit = (colors: Tokens): string[] => {
        const done: string[] = [];
        for (const { role, light, dark } of roles) {
          done.push(...labelIfChanged(colors, role, () => {
            const token = findToken(allTokens(COLORS, colors), [role]);
            const path = token?.path ?? [role];
            const current = token?.value;
            const base = light ?? (typeof current === 'string' ? current : current?.light);
            if (base === undefined) throw tokensError('color-mode-new', `"${role}" is new: give it a color, not only a dark one.`, `E.g. --${role} "#2563eb".`);
            const keptDark = dark ?? (typeof current === 'object' ? current.dark : undefined);
            setToken(COLORS, colors, path, base);
            if (keptDark !== undefined && keptDark !== base) setToken(COLORS, colors, path, keptDark, 'dark');
            // The text on the role follows it, when the palette has one and the role is a plain color.
            const on = findToken(allTokens(COLORS, colors), ['on', role]);
            if (on && PLAIN.test(base)) {
              setToken(COLORS, colors, on.path, onColor(base));
              if (keptDark !== undefined && PLAIN.test(keptDark)) setToken(COLORS, colors, on.path, onColor(keptDark), 'dark');
            }
          }));
        }
        return [...done, ...setAndRemoveEdit(colors)];
      };
      changed = await planTokens(changes, config, COLORS, edit, options.force);
      await planTokenImports(changes, config);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      return { ok: false, dryRun: options.dryRun, actions: changes.actions, issues: error.issues };
    }

    if (!options.dryRun) await changes.apply();
    const written = changes.actions.some((action) => action.type !== 'skip');
    const summary = changed.length ? `Palette updated: ${changed.join(', ')}.` : written ? 'Palette written from colors.json.' : 'The palette already has these colors.';
    return { ok: true, dryRun: options.dryRun, actions: changes.actions, issues: [], summary, data: { changed } };
  },
});
