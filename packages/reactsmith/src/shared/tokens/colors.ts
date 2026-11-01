import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig, StyleLibrary } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { IssueError, type Issue } from '../issues.js';
import { DEFAULT_PALETTE, handEditedLines, onColor, palettePath, PALETTE_FILE, readPalette, type Palette, type PaletteColor } from '../styles/palette.js';

/**
 * The colors of the app, as a hierarchy in tokens/colors.json: the file the team and the commands edit. The CSS
 * variables (tokens/colors.css) and the TypeScript type of the token names (tokens/colors.ts) are generated from it.
 * Other kinds of tokens (spacing, radius, typography) follow the same shape, each in its own file.
 *
 *   { "$modes": ["light", "dark"],
 *     "primary": { "default": "#2563eb", "hover": "color-mix(in oklch, {primary} 85%, black)" },
 *     "text": { "default": { "light": "#1e1e1e", "dark": "#f5f5f5" } } }
 *
 * A path is a CSS variable: text.default.secondary → --color-text-default-secondary; "default" keys at the end add
 * nothing, so primary.default → --color-primary. A value is a color, a reference to another token ("{brand.800}"), a CSS
 * expression using references, or one value per mode.
 */

export const TOKENS_FOLDER = 'tokens';
export const COLORS_NAME = 'colors';
export const DEFAULT_MODES = ['light', 'dark'];
const MODES_KEY = '$modes';
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REFERENCE = /\{([^{}]+)\}/g;
const USAGE = /var\(\s*--color-([a-z0-9-]+)\s*[,)]/g;

export type ColorValue = string | Record<string, string>;
export interface ColorTree {
  [key: string]: ColorValue | ColorTree;
}
export interface Colors {
  modes: string[];
  tree: ColorTree;
}
export interface ColorToken {
  /** Its keys in the hierarchy: ["text", "default", "secondary"]. */
  path: string[];
  /** Its CSS variable without "--color-": "text-default-secondary". */
  name: string;
  value: ColorValue;
}

function colorsError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The tokens folder next to the global styles, and the colors files in it. */
export function colorsPaths(config: ResolvedConfig): { json: string; css: string; ts: string; dir: string } | undefined {
  if (!config.folders.app || !config.appFolders.styles) return undefined;
  const dir = `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/${TOKENS_FOLDER}`;
  return { dir, json: `${dir}/${COLORS_NAME}.json`, css: `${dir}/${COLORS_NAME}.css`, ts: `${dir}/${COLORS_NAME}.ts` };
}

/** "Text/Default/Secondary" or "text.default.secondary" → ["text", "default", "secondary"]; "Tertiary Hover" → "tertiary-hover". */
export function tokenPath(text: string): string[] {
  const path = text.trim().split(/[/.]/).map((segment) => segment.trim().toLowerCase().replace(/[\s_]+/g, '-'));
  const invalid = path.find((segment) => !SEGMENT.test(segment));
  if (invalid !== undefined) {
    throw colorsError('color-path-invalid', `"${text}" is not a token path: "${invalid}" is not a valid key.`, 'Write the path with "/" or ".", each key in letters, digits and dashes, e.g. "text/default/secondary".');
  }
  return path;
}

const isGroup = (value: ColorValue | ColorTree | undefined, modes: string[]): value is ColorTree =>
  typeof value === 'object' && !isModeValues(value, modes);

/** An object with a mode among its keys and only text values: one value per mode, not a group. */
function isModeValues(value: object, modes: string[]): value is Record<string, string> {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.some(([key]) => modes.includes(key)) && entries.every(([, inner]) => typeof inner === 'string');
}

/**
 * The CSS name of a path: its keys joined, without the "default" keys at the end. So a color that becomes the
 * default of a group (text → text.default) keeps its name: text.default.default is still --color-text.
 */
function cssName(path: string[]): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === 'default') end--;
  return path.slice(0, end).join('-');
}

/** The tokens of a hierarchy, in order. */
export function colorTokens(colors: Colors): ColorToken[] {
  const tokens: ColorToken[] = [];
  const visit = (tree: ColorTree, prefix: string[]) => {
    for (const [key, value] of Object.entries(tree)) {
      const path = [...prefix, key];
      if (isGroup(value, colors.modes)) visit(value, path);
      else tokens.push({ path, name: cssName(path), value: value as ColorValue });
    }
  };
  visit(colors.tree, []);
  return tokens;
}

/** The token a path or reference names: the token itself, or the "default" of a group. */
export function findToken(tokens: ColorToken[], path: string[]): ColorToken | undefined {
  const key = path.join('.');
  return tokens.find((token) => token.path.join('.') === key) ?? tokens.find((token) => token.path.join('.') === `${key}.default`);
}

/** Reads colors.json: its modes and its hierarchy, with the keys and values checked. */
export function parseColors(text: string, fileRel: string): Colors {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw colorsError('colors-invalid', `${fileRel} is not valid JSON: ${(error as Error).message}.`, 'Fix the JSON, or rewrite the file with "style palette --force".', fileRel);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw colorsError('colors-invalid', `${fileRel} must hold an object.`, 'E.g. { "$modes": ["light", "dark"], "primary": "#2563eb" }.', fileRel);
  const { [MODES_KEY]: modes = DEFAULT_MODES, ...tree } = raw as Record<string, unknown>;
  if (!Array.isArray(modes) || modes.length === 0 || modes.some((mode) => typeof mode !== 'string' || !SEGMENT.test(mode))) {
    throw colorsError('colors-invalid', `"${MODES_KEY}" in ${fileRel} must be a list of mode names.`, 'E.g. "$modes": ["light", "dark"].', fileRel);
  }
  const check = (value: unknown, path: string[]): void => {
    const where = path.join('.');
    if (path.length && !SEGMENT.test(path[path.length - 1]!)) throw colorsError('colors-invalid', `"${where}" in ${fileRel} is not a valid key.`, 'Keys are lowercase letters, digits and dashes, e.g. "text-muted".', fileRel);
    if (typeof value === 'string') return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw colorsError('colors-invalid', `"${where}" in ${fileRel} is neither a color nor a group.`, 'A token is a color, "{a.reference}", or one value per mode; a group is an object of tokens.', fileRel);
    if (isModeValues(value, modes as string[])) return;
    for (const [key, inner] of Object.entries(value)) check(inner, [...path, key]);
  };
  check(tree, []);
  return { modes: modes as string[], tree: tree as ColorTree };
}

/** colors.json as the commands write it. */
export function serializeColors(colors: Colors): string {
  return `${JSON.stringify({ [MODES_KEY]: colors.modes, ...colors.tree }, null, 2)}\n`;
}

/** The references of a value: "color-mix(in oklch, {primary} 85%, black)" → [["primary"]]. */
export function colorReferences(value: ColorValue): string[][] {
  const texts = typeof value === 'string' ? [value] : Object.values(value);
  return texts.flatMap((text) => [...text.matchAll(REFERENCE)].map((match) => match[1]!.split(/[/.]/).map((segment) => segment.trim())));
}

/** Everything wrong with a hierarchy: two tokens with one CSS name, values missing a mode, unknown modes, references to nothing, loops. */
export function colorsIssues(colors: Colors, fileRel: string): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, hint: string) => issues.push({ severity: 'error', code, path: fileRel, message, hint });
  const tokens = colorTokens(colors);
  const byName = new Map<string, string>();
  for (const token of tokens) {
    const key = token.path.join('.');
    const other = byName.get(token.name);
    if (other) error('color-name-taken', `"${key}" and "${other}" are both --color-${token.name}.`, 'Rename one of them: "default" keys at the end add nothing to the name.');
    byName.set(token.name, key);
    if (typeof token.value === 'object') {
      const missing = colors.modes.filter((mode) => !(mode in (token.value as Record<string, string>)));
      const unknown = Object.keys(token.value).filter((mode) => !colors.modes.includes(mode));
      if (missing.length) error('color-mode-missing', `"${key}" has no value for ${missing.map((mode) => `"${mode}"`).join(', ')}.`, `Give it one, e.g. "style palette --set \\"${key}=#…\\" --mode ${missing[0]}", or one value for all modes.`);
      if (unknown.length) error('color-mode-unknown', `"${key}" has a value for ${unknown.map((mode) => `"${mode}"`).join(', ')}, which is not a mode.`, `The modes are ${colors.modes.join(', ')} ("${MODES_KEY}").`);
    }
    for (const reference of colorReferences(token.value)) {
      if (!findToken(tokens, reference)) error('color-reference-unknown', `"${key}" refers to {${reference.join('.')}}, which is not a token.`, 'Refer to an existing token, or add it first.');
    }
  }
  // Loops of references: a token that, through others, refers to itself.
  const edges = new Map(tokens.map((token) => [token.path.join('.'), colorReferences(token.value).map((reference) => findToken(tokens, reference)?.path.join('.')).filter((target): target is string => !!target)]));
  const reported = new Set<string>();
  const visit = (key: string, trail: string[]): void => {
    if (trail.includes(key)) {
      const loop = [...trail.slice(trail.indexOf(key)), key];
      if (!loop.some((step) => reported.has(step))) error('color-reference-loop', `Tokens refer to each other in a loop: ${loop.join(' → ')}.`, 'Give one of them a color.');
      loop.forEach((step) => reported.add(step));
      return;
    }
    for (const next of edges.get(key) ?? []) visit(next, [...trail, key]);
  };
  for (const key of edges.keys()) visit(key, []);
  return issues;
}

/** A value as CSS: references become variables, "{brand.800}" → "var(--color-brand-800)". */
function cssOf(text: string, tokens: ColorToken[]): string {
  return text.replace(REFERENCE, (match, reference: string) => {
    const token = findToken(tokens, reference.split(/[/.]/).map((segment) => segment.trim()));
    return token ? `var(--color-${token.name})` : match;
  });
}

/**
 * The CSS of the colors: one variable per token, in :root (or Tailwind's @theme). Light and dark values are one
 * light-dark() value; any other mode sets its values under [data-theme="<mode>"].
 */
export function colorsCss(colors: Colors, library: StyleLibrary): string {
  const tokens = colorTokens(colors);
  const base = colors.modes.includes('light') ? 'light' : colors.modes[0]!;
  const others = colors.modes.filter((mode) => mode !== base && mode !== 'dark');
  const value = (token: ColorToken): string => {
    if (typeof token.value === 'string') return cssOf(token.value, tokens);
    const light = cssOf(token.value[base] ?? Object.values(token.value)[0]!, tokens);
    const dark = token.value.dark !== undefined && colors.modes.includes('dark') ? cssOf(token.value.dark, tokens) : undefined;
    return dark && dark !== light ? `light-dark(${light}, ${dark})` : light;
  };
  const lines: string[] = [];
  let group: string | undefined;
  for (const token of tokens) {
    if (group !== undefined && token.path[0] !== group) lines.push('');
    group = token.path[0];
    lines.push(`  --color-${token.name}: ${value(token)};`);
  }
  const header = `/* Colors, written from ${COLORS_NAME}.json by "reactsmith style palette": change ${COLORS_NAME}.json or use the command, not this file. */`;
  const blocks = [`${library === 'tailwind' ? '@theme' : ':root'} {\n${lines.join('\n')}\n}`];
  for (const mode of others) {
    const set = tokens.filter((token) => typeof token.value === 'object' && token.value[mode] !== undefined);
    if (set.length) blocks.push(`[data-theme="${mode}"] {\n${set.map((token) => `  --color-${token.name}: ${cssOf((token.value as Record<string, string>)[mode]!, tokens)};`).join('\n')}\n}`);
  }
  return `${header}\n${blocks.join('\n\n')}\n`;
}

/** The TypeScript of the colors: every token name, and their type. */
export function colorsTs(colors: Colors): string {
  const names = colorTokens(colors).map((token) => `  '${token.name}',`);
  return [
    `// Color tokens, written from ${COLORS_NAME}.json by "reactsmith style palette": each one is the CSS variable var(--color-<token>).`,
    `export const COLOR_TOKENS = [\n${names.join('\n')}\n] as const;`,
    '',
    'export type ColorToken = (typeof COLOR_TOKENS)[number];',
    '',
  ].join('\n');
}

/** The default hierarchy: the brand and status roles, the neutral shades, and the text on each colored role. */
export function defaultColors(palette: Palette = DEFAULT_PALETTE): Colors {
  const modes = (color: PaletteColor): ColorValue => (color.dark && color.dark !== color.light ? { light: color.light, dark: color.dark } : color.light);
  const on = (color: PaletteColor): ColorValue => modes({ light: onColor(color.light), dark: color.dark && onColor(color.dark) });
  const brand = (color: PaletteColor, name: string): ColorTree => ({
    default: modes(color),
    hover: `color-mix(in oklch, {${name}} 85%, black)`,
    subtle: `color-mix(in oklch, {${name}} 12%, transparent)`,
  });
  // Neutral shades: mixed with white in light mode, with black in dark mode (text the other way round).
  const shade = (light: number, dark: number, text = false): ColorValue => ({
    light: `color-mix(in oklch, {neutral} ${light}%, ${text ? 'black' : 'white'})`,
    dark: `color-mix(in oklch, {neutral} ${dark}%, ${text ? 'white' : 'black'})`,
  });
  return {
    modes: [...DEFAULT_MODES],
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

/** The group a path points into, created on the way; a token on the way becomes the "default" of a new group. */
function groupFor(colors: Colors, path: string[]): ColorTree {
  let tree = colors.tree;
  for (const key of path) {
    const inner = tree[key];
    if (inner === undefined) tree[key] = {};
    else if (!isGroup(inner, colors.modes)) tree[key] = { default: inner as ColorValue };
    tree = tree[key] as ColorTree;
  }
  return tree;
}

/**
 * Sets a token: its value for every mode, or with `mode` for that mode only. A new token is added. Setting a group
 * is refused: its tokens are set one by one.
 */
export function setColor(colors: Colors, path: string[], value: string, mode?: string): void {
  const key = path.join('.');
  if (mode !== undefined && !colors.modes.includes(mode)) throw colorsError('color-mode-unknown', `"${mode}" is not a mode.`, `The modes are ${colors.modes.join(', ')}.`);
  const parent = groupFor(colors, path.slice(0, -1));
  const last = path[path.length - 1]!;
  const current = parent[last];
  if (isGroup(current, colors.modes)) {
    if ('default' in current) return setColor(colors, [...path, 'default'], value, mode);
    throw colorsError('color-path-group', `"${key}" is a group of colors, not a color.`, `Set one of its colors, e.g. "${key}/${Object.keys(current)[0]}".`);
  }
  if (mode === undefined) parent[last] = value;
  else if (current === undefined && colors.modes.length > 1) {
    throw colorsError('color-mode-new', `"${key}" is new: it needs a value for every mode, not only "${mode}".`, 'Set it without --mode first, then set each mode.');
  } else {
    const values: Record<string, string> = typeof current === 'object' ? { ...(current as Record<string, string>) } : Object.fromEntries(colors.modes.map((each) => [each, current ?? value]));
    values[mode] = value;
    parent[last] = Object.values(values).every((each) => each === value) ? value : values;
  }
}

/** Removes a token or a group, and the groups it leaves empty. Returns the tokens removed. */
export function removeColor(colors: Colors, path: string[]): ColorToken[] {
  const key = path.join('.');
  const removed = colorTokens(colors).filter((token) => token.path.join('.') === key || token.path.join('.').startsWith(`${key}.`));
  if (removed.length === 0) throw colorsError('color-missing', `There is no color "${key}".`, 'Check the path in colors.json.');
  const trail: ColorTree[] = [colors.tree];
  for (const segment of path.slice(0, -1)) trail.push(trail[trail.length - 1]![segment] as ColorTree);
  delete trail[trail.length - 1]![path[path.length - 1]!];
  for (let depth = trail.length - 1; depth > 0; depth--) {
    if (Object.keys(trail[depth]!).length === 0) delete trail[depth - 1]![path[depth - 1]!];
  }
  return removed;
}

/** "--color-primary" uses in the project's styles and code, by token name, outside the tokens folder. */
export async function colorUsages(read: (fileRel: string) => Promise<string | undefined>, root: string, config: ResolvedConfig): Promise<Map<string, string[]>> {
  const usages = new Map<string, string[]>();
  const tokensDir = colorsPaths(config)?.dir;
  for (const file of await listFiles(path.join(root, config.srcDir)).catch(() => [])) {
    const fileRel = toRelative(root, file);
    if (!/\.(css|tsx?)$/.test(fileRel) || (tokensDir && fileRel.startsWith(`${tokensDir}/`))) continue;
    for (const match of ((await read(fileRel)) ?? '').matchAll(USAGE)) {
      const files = usages.get(match[1]!) ?? [];
      if (!files.includes(fileRel)) usages.set(match[1]!, [...files, fileRel]);
    }
  }
  return usages;
}

/** The colors a style uses that are not tokens: "var(--color-brand)" when there is no brand. */
export function unknownColors(text: string, colors: Colors): string[] {
  const names = new Set(colorTokens(colors).map((token) => token.name));
  return [...new Set([...text.matchAll(USAGE)].map((match) => match[1]!))].filter((name) => !names.has(name));
}

/** The project's colors, or undefined when it has no colors.json yet. */
export async function readColors(read: (fileRel: string) => Promise<string | undefined>, config: ResolvedConfig): Promise<Colors | undefined> {
  const paths = colorsPaths(config);
  const text = paths && (await read(paths.json));
  return text === undefined || !paths ? undefined : parseColors(text, paths.json);
}

/** The refusal for colors a style uses that are not tokens. */
export function unknownColorsError(unknown: string[], fileRel?: string): IssueError {
  return colorsError(
    'color-unknown',
    `${unknown.map((name) => `--color-${name}`).join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in the palette.`,
    `Use a color of tokens/colors.json, or add it first: "style palette --set \\"${unknown[0]!.replace(/-/g, '/')}=#…\\"".`,
    fileRel,
  );
}

export interface ColorsEdit {
  /** Changes the hierarchy; returns what changed, for the summary. */
  (colors: Colors): string[];
}

/**
 * Plans the colors files: reads colors.json (or migrates the old palette.css into it, or starts from the defaults),
 * applies `edit`, checks the result, and writes colors.json, colors.css and colors.ts where they differ. A
 * palette.css changed by hand is refused rather than lost, unless `force`; without an edit (init), it is kept.
 */
export async function planColors(changes: ChangeSet, config: ResolvedConfig, edit?: ColorsEdit, force = false): Promise<string[]> {
  const paths = colorsPaths(config);
  if (!paths) throw colorsError('styles-disabled', 'The colors need the app styles folder.', 'Set "folders.app" and "appFolders.styles" in the config.');
  const jsonText = await changes.read(paths.json);
  let colors: Colors;
  const legacyRel = palettePath(config)!;
  const legacy = jsonText === undefined ? await changes.read(legacyRel) : undefined;
  if (jsonText !== undefined) {
    colors = parseColors(jsonText, paths.json);
  } else if (legacy !== undefined) {
    const edited = handEditedLines(config.styles, legacy);
    if (edited.length && !force) {
      if (!edit) {
        changes.skip(legacyRel, 'palette changed by hand, kept');
        return [];
      }
      const shown = edited.slice(0, 3).map((line) => `"${line}"`).join(', ');
      throw colorsError(
        'palette-edited',
        `${legacyRel} was changed by hand: ${shown}${edited.length > 3 ? ` and ${edited.length - 3} more` : ''}.`,
        `The colors now live in ${paths.json}, written from palette.css. Put your changes there after the migration, or run again with --force to migrate without them.`,
        legacyRel,
      );
    }
    colors = defaultColors(readPalette(legacy));
    changes.delete(legacyRel, `palette moved to ${paths.json}`);
  } else {
    colors = defaultColors();
  }

  const changed = edit ? edit(colors) : [];
  const issues = colorsIssues(colors, paths.json);
  if (issues.length) throw new IssueError(issues);

  const write = async (fileRel: string, content: string, label: string) => {
    const current = await changes.read(fileRel);
    if (current === undefined) changes.write(fileRel, content, { type: 'create', message: label });
    else if (current !== content) changes.write(fileRel, content, { type: 'update', message: changed.length ? `${label}: ${changed.join(', ')}` : `${label} rewritten` });
    else changes.skip(fileRel, `${label} unchanged`);
  };
  // colors.json keeps its own formatting until the command changes it.
  if (jsonText === undefined || changed.length) await write(paths.json, serializeColors(colors), 'colors');
  await write(paths.css, colorsCss(colors, config.styles), 'color variables');
  await write(paths.ts, colorsTs(colors), 'color token type');
  return changed;
}

/** The import of the colors in the global styles, relative to them. */
export const COLORS_IMPORT = `@import './${TOKENS_FOLDER}/${COLORS_NAME}.css';`;
/** The import of the old palette, which the colors replace. */
export const LEGACY_PALETTE_IMPORT = new RegExp(`@import\\s+['"]\\./${PALETTE_FILE.replace('.', '\\.')}['"];?`);

/** Checks the colors of the project: colors.json valid, its generated files current, and every color the styles use a token. */
export async function checkColors(root: string, config: ResolvedConfig, read: (fileRel: string) => Promise<string | undefined>): Promise<Issue[]> {
  const paths = colorsPaths(config);
  if (!paths) return [];
  const jsonText = await read(paths.json);
  if (jsonText === undefined) {
    const legacy = palettePath(config);
    return legacy && (await read(legacy)) !== undefined
      ? [{ severity: 'warning', code: 'palette-legacy', path: legacy, message: `The colors are still in ${legacy}.`, hint: `Run "style palette" to move them to ${paths.json}, where they can be any hierarchy.` }]
      : [];
  }
  let colors: Colors;
  try {
    colors = parseColors(jsonText, paths.json);
  } catch (error) {
    if (error instanceof IssueError) return error.issues;
    throw error;
  }
  const issues = colorsIssues(colors, paths.json);
  if (issues.length) return issues;
  for (const [fileRel, expected] of [[paths.css, colorsCss(colors, config.styles)], [paths.ts, colorsTs(colors)]] as const) {
    if ((await read(fileRel)) !== expected) {
      issues.push({ severity: 'error', code: 'colors-stale', path: fileRel, message: `${fileRel} doesn't match ${paths.json}.`, hint: `It is written from ${COLORS_NAME}.json: run "style palette" to write it again.` });
    }
  }
  const names = new Set(colorTokens(colors).map((token) => token.name));
  for (const [name, files] of await colorUsages(read, root, config)) {
    if (names.has(name)) continue;
    for (const fileRel of files) {
      issues.push({ severity: 'error', code: 'color-unknown', path: fileRel, message: `--color-${name} is not in the palette.`, hint: `Use a color of ${paths.json}, or add it: "style palette --set \\"${name.replace(/-/g, '/')}=#…\\"".` });
    }
  }
  return issues;
}
