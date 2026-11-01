import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { DEFAULT_PALETTE, handEditedLines, onColor, palettePath, PALETTE_FILE, parseColor, readPalette, type Palette, type PaletteColor } from '../styles/palette.js';
import { parseTokens, planTokens, tokensError, tokensImport, tokensIssues, tokensPaths, type TokenKind, type Tokens, type TokensEdit, type TokenTree, type TokenValue } from './engine.js';

export { tokenPath } from './engine.js';

/** The default palette: the brand and status roles, the neutral shades, and the text on each colored role. */
export function defaultColors(palette: Palette = DEFAULT_PALETTE): Tokens {
  const modes = (color: PaletteColor): TokenValue => (color.dark && color.dark !== color.light ? { light: color.light, dark: color.dark } : color.light);
  const on = (color: PaletteColor): TokenValue => modes({ light: onColor(color.light), dark: color.dark && onColor(color.dark) });
  const brand = (color: PaletteColor, name: string): TokenTree => ({
    default: modes(color),
    hover: `color-mix(in oklch, {${name}} 85%, black)`,
    subtle: `color-mix(in oklch, {${name}} 12%, transparent)`,
  });
  // Neutral shades: mixed with white in light mode, with black in dark mode (text the other way round).
  const shade = (light: number, dark: number, text = false): TokenValue => ({
    light: `color-mix(in oklch, {neutral} ${light}%, ${text ? 'black' : 'white'})`,
    dark: `color-mix(in oklch, {neutral} ${dark}%, ${text ? 'white' : 'black'})`,
  });
  return {
    modes: ['light', 'dark'],
    media: {},
    tree: {
      primary: brand(palette.primary, 'primary'),
      secondary: brand(palette.secondary, 'secondary'),
      neutral: palette.neutral.light,
      bg: shade(2, 12),
      surface: shade(6, 18),
      border: shade(25, 40),
      text: { default: shade(25, 8, true), muted: shade(85, 70, true) },
      success: modes(palette.success),
      warning: modes(palette.warning),
      danger: modes(palette.danger),
      info: modes(palette.info),
      on: Object.fromEntries((['primary', 'secondary', 'success', 'warning', 'danger', 'info'] as const).map((role) => [role, on(palette[role])])),
    },
  };
}

/**
 * The colors of the app, any hierarchy: text.default.secondary is --color-text-default-secondary. Projects made
 * before kept them in app/styles/palette.css, which moves into colors.json the first time it is written.
 */
export const COLORS: TokenKind = {
  file: 'colors',
  code: 'color',
  command: 'style palette',
  defaultModes: ['light', 'dark'],
  prefix: '--color-',
  constName: 'COLOR_TOKENS',
  typeName: 'ColorToken',
  checkValue(value) {
    if (/^(#|rgba?\(|hsla?\()/i.test(value)) {
      try {
        return parseColor(value, 'The color');
      } catch {
        return { error: 'it is not a valid color.' };
      }
    }
    return /^[a-z-]+\(.*\)$/i.test(value) || /^[a-z]+$/i.test(value) ? value : { error: 'use a color ("#2563eb"), a token ("{brand.800}") or a CSS color expression.' };
  },
  defaults: () => defaultColors(),
  async migrate(changes: ChangeSet, config: ResolvedConfig, editing: boolean, force: boolean) {
    const legacyRel = palettePath(config);
    const legacy = legacyRel && (await changes.read(legacyRel));
    if (!legacyRel || legacy === undefined) return undefined;
    const edited = handEditedLines(config.styles, legacy);
    if (edited.length && !force) {
      if (!editing) {
        changes.skip(legacyRel, 'palette changed by hand, kept');
        return 'kept';
      }
      const shown = edited.slice(0, 3).map((line) => `"${line}"`).join(', ');
      throw tokensError(
        'palette-edited',
        `${legacyRel} was changed by hand: ${shown}${edited.length > 3 ? ` and ${edited.length - 3} more` : ''}.`,
        `The colors now live in ${tokensPaths(config, COLORS)!.json}, written from palette.css. Put your changes there after the move, or run again with --force to move it without them.`,
        legacyRel,
      );
    }
    changes.delete(legacyRel, `palette moved to ${tokensPaths(config, COLORS)!.json}`);
    return defaultColors(readPalette(legacy));
  },
  async legacyIssue(read, config): Promise<Issue | undefined> {
    const legacy = palettePath(config);
    if (!legacy || (await read(legacy)) === undefined) return undefined;
    return { severity: 'warning', code: 'palette-legacy', path: legacy, message: `The colors are still in ${legacy}.`, hint: `Run "style palette" to move them to ${tokensPaths(config, COLORS)!.json}, where they can be any hierarchy.` };
  },
};

/** The import of the colors in the global styles, and of the old palette they replace. */
export const COLORS_IMPORT = tokensImport(COLORS);
export const LEGACY_PALETTE_IMPORT = new RegExp(`@import\\s+['"]\\./${PALETTE_FILE.replace('.', '\\.')}['"];?`);

export const parseColors = (text: string, fileRel: string): Tokens => parseTokens(COLORS, text, fileRel);
export const colorsIssues = (colors: Tokens, fileRel: string) => tokensIssues(COLORS, colors, fileRel);
export const planColors = (changes: ChangeSet, config: ResolvedConfig, edit?: TokensEdit, force = false) => planTokens(changes, config, COLORS, edit, force);
