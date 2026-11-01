import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { globalCssHolds, globalCssPath, takeFromGlobalCss, tokensImport, tokensPaths, type TokenKind, type Tokens } from './engine.js';

/** A CSS length ("0.5rem", "8px", "0"), and the functions that compute one. */
export const LENGTH = /^-?(\d+\.?\d*|\.\d+)(px|rem|em|%|vw|vh|ch)$|^0$/;
export const FUNCTION = /^(clamp|min|max|calc)\(.*\)$/;

const SIZE_MODES = { modes: ['desktop', 'mobile'], media: { mobile: '(max-width: 767px)' } };

/** The spacing steps of the default scale, "--space-<step>": the steps the layout options (--gap, --padding) write as variables. */
export const SPACE_STEPS = [1, 2, 3, 4, 6, 8] as const;

/** The variables global.css held before spacing and radius moved to tokens/. */
const LEGACY_SPACE = /^[ \t]*--space-([a-z0-9-]+):\s*(.+?);[ \t]*\r?\n/gm;
const LEGACY_RADIUS = /^[ \t]*--radius(?:-([a-z0-9-]+))?:\s*(.+?);[ \t]*\r?\n/gm;

/** A kind of sizes: one prefix, lengths as values, desktop and mobile modes, and the variables global.css held before. */
function sizeKind(spec: { file: string; code: string; prefix: string; constName: string; typeName: string; tree: Record<string, string>; legacy: RegExp; what: string }): TokenKind {
  const kind: TokenKind = {
    file: spec.file,
    code: spec.code,
    command: `style ${spec.file}`,
    defaultModes: SIZE_MODES.modes,
    defaultMedia: SIZE_MODES.media,
    prefix: spec.prefix,
    constName: spec.constName,
    typeName: spec.typeName,
    checkValue: (value) => (LENGTH.test(value) || FUNCTION.test(value) ? value : { error: `${spec.what} is a length, e.g. "0.5rem" or "8px", or calc(…).` }),
    defaults: (): Tokens => ({ modes: [...SIZE_MODES.modes], media: { ...SIZE_MODES.media }, tree: { ...spec.tree } }),
    async migrate(changes: ChangeSet, config: ResolvedConfig) {
      const found = await takeFromGlobalCss(changes, config, spec.legacy, kind);
      return found && { ...kind.defaults(), tree: { ...spec.tree, ...found } };
    },
    async legacyIssue(read, config): Promise<Issue | undefined> {
      if (!(await globalCssHolds(read, config, spec.legacy))) return undefined;
      const stylesRel = globalCssPath(config);
      return { severity: 'warning', code: `${spec.file}-legacy`, path: stylesRel, message: `The ${spec.file} variables are still in ${stylesRel}.`, hint: `Run "style ${spec.file}" to move them to ${tokensPaths(config, kind)!.json}.` };
    },
  };
  return kind;
}

/** The spacing of the app: space.2 is --space-2, for gaps, paddings and margins. */
export const SPACING = sizeKind({
  file: 'spacing',
  code: 'space',
  prefix: '--space-',
  constName: 'SPACING_TOKENS',
  typeName: 'SpaceToken',
  tree: Object.fromEntries(SPACE_STEPS.map((step) => [String(step), `${step * 0.25}rem`])),
  legacy: LEGACY_SPACE,
  what: 'a space',
});

/** The corner radii of the app: radius.default is --radius, radius.lg is --radius-lg. */
export const RADIUS = sizeKind({
  file: 'radius',
  code: 'radius',
  prefix: '--radius-',
  constName: 'RADIUS_TOKENS',
  typeName: 'RadiusToken',
  tree: { default: '0.375rem', sm: '0.25rem', lg: '0.5rem', full: '9999px' },
  legacy: LEGACY_RADIUS,
  what: 'a radius',
});

export const SPACING_IMPORT = tokensImport(SPACING);
export const RADIUS_IMPORT = tokensImport(RADIUS);
