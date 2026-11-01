import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { globalCssHolds, globalCssPath, takeFromGlobalCss, tokensImport, tokensPaths, type TokenKind, type Tokens } from './engine.js';
import { FUNCTION, LENGTH } from './sizes.js';

const NUMBER = /^(\d+\.?\d*|\.\d+)$/;

/** The font variables global.css held before the typography moved to tokens/typography.json. */
const LEGACY_FONT = /^[ \t]*--font-(sans|mono):\s*(.+?);[ \t]*\r?\n/gm;

const SYSTEM_SANS = "system-ui, 'Segoe UI', Roboto, sans-serif";
const SYSTEM_MONO = "ui-monospace, 'Cascadia Code', Consolas, monospace";

/** The default typography: system fonts, a type scale, the common weights, line heights and letter spacing. */
export function defaultTypography(families: { sans?: string; mono?: string } = {}): Tokens {
  return {
    modes: ['desktop', 'mobile'],
    media: { mobile: '(max-width: 767px)' },
    tree: {
      family: { sans: families.sans ?? SYSTEM_SANS, mono: families.mono ?? SYSTEM_MONO },
      size: { xs: '0.75rem', sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem', '3xl': '1.875rem', '4xl': '2.25rem' },
      weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
      'line-height': { tight: '1.25', normal: '1.5' },
      'letter-spacing': { tight: '-0.025em', normal: '0' },
    },
  };
}

/**
 * The typography of the app, one property per group, each with Tailwind's prefix: family.sans is --font-sans,
 * size.heading.base is --text-heading-base, weight.bold is --font-weight-bold, line-height.tight is --leading-tight,
 * letter-spacing.tight is --tracking-tight. Its modes are screen sizes: desktop, and mobile in a media query.
 */
export const TYPOGRAPHY: TokenKind = {
  file: 'typography',
  code: 'font',
  command: 'style typography',
  defaultModes: ['desktop', 'mobile'],
  defaultMedia: { mobile: '(max-width: 767px)' },
  groups: {
    family: { prefix: '--font-', type: 'FontFamilyToken' },
    size: { prefix: '--text-', type: 'FontSizeToken' },
    weight: { prefix: '--font-weight-', type: 'FontWeightToken' },
    'line-height': { prefix: '--leading-', type: 'LineHeightToken' },
    'letter-spacing': { prefix: '--tracking-', type: 'LetterSpacingToken' },
  },
  constName: 'TYPOGRAPHY_TOKENS',
  checkValue(value, group) {
    const ok = (valid: boolean, error: string) => (valid ? value : { error });
    switch (group) {
      case 'size':
        return ok(LENGTH.test(value) || FUNCTION.test(value), 'a size is a length, e.g. "1.5rem" or "24px", or clamp(…).');
      case 'weight':
        return ok(/^[1-9]00$/.test(value) || /^(normal|bold|lighter|bolder)$/.test(value), 'a weight is 100 to 900, e.g. "600".');
      case 'line-height':
        return ok(NUMBER.test(value) || LENGTH.test(value) || FUNCTION.test(value) || value === 'normal', 'a line height is a number ("1.5") or a length ("24px").');
      case 'letter-spacing':
        return ok(LENGTH.test(value) || FUNCTION.test(value) || value === 'normal', 'a letter spacing is a length, e.g. "-0.02em".');
      default:
        return ok(value.trim().length > 0, 'a family is a list of fonts, e.g. "Inter, sans-serif".');
    }
  },
  defaults: () => defaultTypography(),
  async migrate(changes: ChangeSet, config: ResolvedConfig) {
    const families = await takeFromGlobalCss(changes, config, LEGACY_FONT, TYPOGRAPHY);
    return families && defaultTypography(families);
  },
  async legacyIssue(read, config): Promise<Issue | undefined> {
    if (!(await globalCssHolds(read, config, LEGACY_FONT))) return undefined;
    const stylesRel = globalCssPath(config);
    return { severity: 'warning', code: 'typography-legacy', path: stylesRel, message: `The fonts are still in ${stylesRel}.`, hint: `Run "style typography" to move them to ${tokensPaths(config, TYPOGRAPHY)!.json}, with the rest of the typography.` };
  },
};

export const TYPOGRAPHY_IMPORT = tokensImport(TYPOGRAPHY);
