import { defineCommand } from '../../../core/command.js';
import { ChangeSet } from '../../../shared/changes.js';
import { requireConfig } from '../../../shared/config/load.js';
import { IssueError } from '../../../shared/issues.js';
import { planPaletteImport } from '../../../shared/styles/global.js';
import { onColor, PALETTE_ROLES, parseColor, type PaletteRole } from '../../../shared/styles/palette.js';
import { colorReferences, colorTokens, colorUsages, findToken, planColors, removeColor, setColor, tokenPath, type Colors } from '../../../shared/tokens/colors.js';
import { DRY_RUN } from '../../../shared/options.js';

const color = (description: string) => ({ type: 'string', placeholder: 'color', description }) as const;

function paletteError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/** A value for --set: a color, a reference to a token ("{brand.800}"), or a CSS expression ("color-mix(…)"). */
function colorValue(text: string, path: string): string {
  const value = text.trim();
  if (/^(#|rgba?\(|hsla?\()/i.test(value)) return parseColor(value, `"${path}"`);
  if (/\{[^{}]+\}/.test(value) || /^[a-z-]+\(.*\)$/i.test(value) || /^[a-z]+$/i.test(value)) return value;
  throw paletteError('color-invalid', `"${path}" can't be "${value}".`, 'Use a color ("#2563eb"), a token ("{brand.800}") or a CSS color expression ("color-mix(in oklch, {primary} 85%, black)").');
}

/** "a/b=#fff; c.d={a.b}" → [["a/b", "#fff"], ["c.d", "{a.b}"]]. */
function assignments(text: string): [string, string][] {
  return text.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const equals = part.indexOf('=');
    if (equals <= 0) throw paletteError('color-set-invalid', `"${part}" is not "path=value".`, 'E.g. --set "text/default/secondary=#757575".');
    return [part.slice(0, equals).trim(), part.slice(equals + 1).trim()];
  });
}

export const stylePaletteCommand = defineCommand({
  name: 'style palette',
  description: 'Set the colors of the app (tokens/colors.json, any hierarchy): only the given ones change; with no option, it writes the CSS and the type again from colors.json',
  options: {
    set: { type: 'string', placeholder: 'path=value', description: 'Colors to add or change, separated by ";": a path in the hierarchy and a color, a token or a CSS expression, e.g. "text/default/secondary=#757575; background/brand={brand.800}"' },
    mode: { type: 'string', placeholder: 'mode', description: 'The mode the --set values are for, e.g. dark (default: every mode)' },
    remove: { type: 'string', placeholder: 'paths', description: 'Colors or groups to remove, separated by ";": refused while a style or another color uses them' },
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
      const sets = options.set === undefined ? [] : assignments(options.set).map(([path, value]) => ({ path: tokenPath(path), value: colorValue(value, path) }));
      const removes = (options.remove ?? '').split(';').map((path) => path.trim()).filter(Boolean).map(tokenPath);
      if (options.mode !== undefined && sets.length === 0) throw paletteError('options-conflict', '--mode applies to the --set values.', 'Pass the colors with --set, e.g. --set "text/default=#f5f5f5" --mode dark.');

      const config = await requireConfig(cwd);
      const usages = removes.length ? await colorUsages((fileRel) => changes.read(fileRel), cwd, config) : new Map<string, string[]>();
      const edit = (colors: Colors): string[] => {
        const done: string[] = [];
        // Each change is reported only when it changes something.
        const step = (label: string, apply: () => void) => {
          const before = JSON.stringify(colors);
          apply();
          if (JSON.stringify(colors) !== before) done.push(label);
        };
        for (const { role, light, dark } of roles) {
          step(role, () => {
            const token = findToken(colorTokens(colors), [role]);
            const path = token?.path ?? [role];
            const current = token?.value;
            const base = light ?? (typeof current === 'string' ? current : current?.light);
            if (base === undefined) throw paletteError('color-mode-new', `"${role}" is new: give it a color, not only a dark one.`, `E.g. --${role} "#2563eb".`);
            const keptDark = dark ?? (typeof current === 'object' ? current.dark : undefined);
            setColor(colors, path, base);
            if (keptDark !== undefined && keptDark !== base) setColor(colors, path, keptDark, 'dark');
            // The text on the role follows it, when the palette has one and the role is a plain color.
            const on = findToken(colorTokens(colors), ['on', role]);
            if (on && /^(#|rgb|hsl)/.test(base)) {
              setColor(colors, on.path, onColor(base));
              if (keptDark !== undefined && /^(#|rgb|hsl)/.test(keptDark)) setColor(colors, on.path, onColor(keptDark), 'dark');
            }
          });
        }
        for (const { path, value } of sets) step(path.join('/'), () => setColor(colors, path, value, options.mode));
        for (const path of removes) {
          const removed = removeColor(colors, path);
          const users = removed.flatMap((token) => usages.get(token.name) ?? []);
          if (users.length) throw paletteError('color-in-use', `"${path.join('/')}" is still used in ${[...new Set(users)].join(', ')}.`, 'Change those styles to another color first.');
          const rest = colorTokens(colors);
          const referrers = rest.filter((token) => colorReferences(token.value).some((reference) => !findToken(rest, reference) && findToken(removed, reference)));
          if (referrers.length) throw paletteError('color-in-use', `"${path.join('/')}" is still used by ${referrers.map((token) => `"${token.path.join('/')}"`).join(', ')}.`, 'Give those colors another value first.');
          done.push(`removed ${path.join('/')}`);
        }
        return done;
      };
      changed = await planColors(changes, config, edit, options.force);
      await planPaletteImport(changes, config);
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
