import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig, StyleLibrary } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { IssueError, type Issue } from '../issues.js';

/**
 * Design tokens: each kind (colors, typography…) is a hierarchy in tokens/<kind>.json, the file the team and the
 * commands edit. Its CSS variables (tokens/<kind>.css) and the TypeScript type of its token names (tokens/<kind>.ts)
 * are written from it.
 *
 *   { "$modes": ["light", "dark"],
 *     "primary": { "default": "#2563eb", "hover": "color-mix(in oklch, {primary} 85%, black)" } }
 *
 * A path is a CSS variable: text.default.secondary → --color-text-default-secondary; "default" keys at the end add
 * nothing, so primary.default → --color-primary. A value is a plain value, a reference to another token of the kind
 * ("{brand.800}"), a CSS expression using references, or one value per mode.
 */

export const TOKENS_FOLDER = 'tokens';
const MODES_KEY = '$modes';
const MEDIA_KEY = '$media';
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REFERENCE = /\{([^{}]+)\}/g;
const VARIABLE_USE = /var\(\s*(--[a-z0-9-]+)\s*[,)]/g;
/** Whether a value holds a reference, without the state of the global REFERENCE. */
const hasReference = (text: string) => /\{[^{}]+\}/.test(text);

export type TokenValue = string | Record<string, string>;
export interface TokenTree {
  [key: string]: TokenValue | TokenTree;
}
export interface Tokens {
  modes: string[];
  /** The media query of each mode that is a screen size: "mobile" → "(max-width: 767px)". */
  media: Record<string, string>;
  tree: TokenTree;
}
export interface Token {
  /** Its keys in the hierarchy: ["text", "default", "secondary"]. */
  path: string[];
  /** Its name without the prefix of its group, as in the TypeScript type: "text-default-secondary". */
  name: string;
  /** Its CSS variable: "--color-text-default-secondary". */
  variable: string;
  /** The group at the top it belongs to, for kinds made of groups ("size" in typography). */
  group?: string;
  value: TokenValue;
}

/** What a kind of tokens is: its files, its CSS names, its values and its defaults. */
export interface TokenKind {
  /** The files' name: "colors" → tokens/colors.json. */
  file: string;
  /** The start of its issue codes: "color" → color-mode-missing. */
  code: string;
  /** The command that edits it: "style palette". */
  command: string;
  defaultModes: string[];
  defaultMedia?: Record<string, string>;
  /** One prefix for every token ("--color-"), or a group per key at the top, each with its prefix and type. */
  prefix?: string;
  groups?: Record<string, { prefix: string; type: string }>;
  /** The constant and type of the token names in tokens/<kind>.ts, for a kind without groups. */
  constName: string;
  typeName?: string;
  /** Checks a value given without references: the value as written, or a message when it can't be one. */
  checkValue?(value: string, group: string | undefined): string | { error: string };
  defaults(): Tokens;
  /**
   * The tokens of a project that has no <kind>.json yet, from where they were before (an older file), with the
   * changes that move them; "kept" when the older file must stay as it is; undefined for the defaults.
   */
  migrate?(changes: ChangeSet, config: ResolvedConfig, editing: boolean, force: boolean): Promise<Tokens | 'kept' | undefined>;
  /** An issue about the older file when the kind has no <kind>.json yet. */
  legacyIssue?(read: (fileRel: string) => Promise<string | undefined>, config: ResolvedConfig): Promise<Issue | undefined>;
}

export function tokensError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The tokens folder next to the global styles, and the files of a kind in it. */
export function tokensPaths(config: ResolvedConfig, kind: TokenKind): { json: string; css: string; ts: string; dir: string } | undefined {
  if (!config.folders.app || !config.appFolders.styles) return undefined;
  const dir = `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/${TOKENS_FOLDER}`;
  return { dir, json: `${dir}/${kind.file}.json`, css: `${dir}/${kind.file}.css`, ts: `${dir}/${kind.file}.ts` };
}

/** "Text/Default/Secondary" or "text.default.secondary" → ["text", "default", "secondary"]; "Tertiary Hover" → "tertiary-hover". */
export function tokenPath(text: string): string[] {
  const keys = text.trim().split(/[/.]/).map((segment) => segment.trim().toLowerCase().replace(/[\s_]+/g, '-'));
  const invalid = keys.find((segment) => !SEGMENT.test(segment));
  if (invalid !== undefined) {
    throw tokensError('token-path-invalid', `"${text}" is not a token path: "${invalid}" is not a valid key.`, 'Write the path with "/" or ".", each key in letters, digits and dashes, e.g. "text/default/secondary".');
  }
  return keys;
}

/** An object with a mode among its keys and only text values: one value per mode, not a group. */
function isModeValues(value: object, modes: string[]): value is Record<string, string> {
  const entries = Object.entries(value);
  return entries.length > 0 && entries.some(([key]) => modes.includes(key)) && entries.every(([, inner]) => typeof inner === 'string');
}

const isGroup = (value: TokenValue | TokenTree | undefined, modes: string[]): value is TokenTree => typeof value === 'object' && !isModeValues(value, modes);

/**
 * The CSS name of a path: its keys joined, without the "default" keys at the end. So a token that becomes the
 * default of a group (text → text.default) keeps its name: text.default.default is still --color-text.
 */
function cssName(keys: string[]): string {
  let end = keys.length;
  while (end > 1 && keys[end - 1] === 'default') end--;
  return keys.slice(0, end).join('-');
}

/** The tokens of a hierarchy, in order. */
export function allTokens(kind: TokenKind, tokens: Tokens): Token[] {
  const found: Token[] = [];
  const visit = (tree: TokenTree, prefix: string[]) => {
    for (const [key, value] of Object.entries(tree)) {
      const keys = [...prefix, key];
      if (isGroup(value, tokens.modes)) {
        visit(value, keys);
        continue;
      }
      const group = kind.groups ? keys[0] : undefined;
      const own = kind.groups ? keys.slice(1) : keys;
      const name = cssName(own);
      const prefixOf = (kind.groups ? kind.groups[group!]?.prefix : kind.prefix) ?? '--';
      // A token that is only "default" is the kind's own variable: radius.default → --radius.
      const variable = own.every((key) => key === 'default') ? prefixOf.replace(/-$/, '') : `${prefixOf}${name}`;
      found.push({ path: keys, name, variable, group, value: value as TokenValue });
    }
  };
  visit(tokens.tree, []);
  return found;
}

/** The token a path or reference names: the token itself, or the "default" of a group. */
export function findToken(tokens: Token[], keys: string[]): Token | undefined {
  const key = keys.join('.');
  return tokens.find((token) => token.path.join('.') === key) ?? tokens.find((token) => token.path.join('.') === `${key}.default`);
}

/** Reads <kind>.json: its modes, their media queries and its hierarchy, with the keys checked. */
export function parseTokens(kind: TokenKind, text: string, fileRel: string): Tokens {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw tokensError(`${kind.file}-invalid`, `${fileRel} is not valid JSON: ${(error as Error).message}.`, `Fix the JSON, then run "${kind.command}" to write the CSS again.`, fileRel);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw tokensError(`${kind.file}-invalid`, `${fileRel} must hold an object.`, `E.g. { "${MODES_KEY}": ${JSON.stringify(kind.defaultModes)}, … }.`, fileRel);
  const { [MODES_KEY]: modes = kind.defaultModes, [MEDIA_KEY]: media = kind.defaultMedia ?? {}, ...tree } = raw as Record<string, unknown>;
  if (!Array.isArray(modes) || modes.length === 0 || modes.some((mode) => typeof mode !== 'string' || !SEGMENT.test(mode))) {
    throw tokensError(`${kind.file}-invalid`, `"${MODES_KEY}" in ${fileRel} must be a list of mode names.`, `E.g. "${MODES_KEY}": ${JSON.stringify(kind.defaultModes)}.`, fileRel);
  }
  if (!media || typeof media !== 'object' || Array.isArray(media) || Object.entries(media).some(([mode, query]) => !modes.includes(mode) || typeof query !== 'string')) {
    throw tokensError(`${kind.file}-invalid`, `"${MEDIA_KEY}" in ${fileRel} must give a media query to some of the modes.`, 'E.g. "$media": { "mobile": "(max-width: 767px)" }.', fileRel);
  }
  const check = (value: unknown, keys: string[]): void => {
    const where = keys.join('.');
    if (keys.length && !SEGMENT.test(keys[keys.length - 1]!)) throw tokensError(`${kind.file}-invalid`, `"${where}" in ${fileRel} is not a valid key.`, 'Keys are lowercase letters, digits and dashes, e.g. "text-muted".', fileRel);
    if (kind.groups && keys.length === 1 && !(keys[0]! in kind.groups)) {
      throw tokensError(`${kind.file}-invalid`, `"${where}" in ${fileRel} is not a group of ${kind.file}.`, `The groups are ${Object.keys(kind.groups).join(', ')}.`, fileRel);
    }
    if (typeof value === 'string') {
      if (kind.groups && keys.length === 1) throw tokensError(`${kind.file}-invalid`, `"${where}" in ${fileRel} is a group: put its values under names, e.g. "${where}": { "base": "${value}" }.`, 'Each token has a name inside its group.', fileRel);
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw tokensError(`${kind.file}-invalid`, `"${where}" in ${fileRel} is neither a value nor a group.`, 'A token is a value, "{a.reference}", or one value per mode; a group is an object of tokens.', fileRel);
    if (keys.length > (kind.groups ? 1 : 0) && isModeValues(value, modes as string[])) return;
    for (const [key, inner] of Object.entries(value)) check(inner, [...keys, key]);
  };
  check(tree, []);
  return { modes: modes as string[], media: media as Record<string, string>, tree: tree as TokenTree };
}

/** <kind>.json as the commands write it. */
export function serializeTokens(tokens: Tokens): string {
  const media = Object.keys(tokens.media).length ? { [MEDIA_KEY]: tokens.media } : {};
  return `${JSON.stringify({ [MODES_KEY]: tokens.modes, ...media, ...tokens.tree }, null, 2)}\n`;
}

/** The references of a value: "color-mix(in oklch, {primary} 85%, black)" → [["primary"]]. */
export function tokenReferences(value: TokenValue): string[][] {
  const texts = typeof value === 'string' ? [value] : Object.values(value);
  return texts.flatMap((text) => [...text.matchAll(REFERENCE)].map((match) => match[1]!.split(/[/.]/).map((segment) => segment.trim())));
}

/** Everything wrong with a hierarchy: two tokens with one CSS name, values missing a mode, unknown modes, wrong values, references to nothing, loops. */
export function tokensIssues(kind: TokenKind, tokens: Tokens, fileRel: string): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, hint: string) => issues.push({ severity: 'error', code: `${kind.code}-${code}`, path: fileRel, message, hint });
  const found = allTokens(kind, tokens);
  const byVariable = new Map<string, string>();
  for (const token of found) {
    const key = token.path.join('.');
    const other = byVariable.get(token.variable);
    if (other) error('name-taken', `"${key}" and "${other}" are both ${token.variable}.`, 'Rename one of them: "default" keys at the end add nothing to the name.');
    byVariable.set(token.variable, key);
    const values = typeof token.value === 'string' ? [token.value] : Object.values(token.value);
    if (typeof token.value === 'object') {
      const missing = tokens.modes.filter((mode) => !(mode in (token.value as Record<string, string>)));
      const unknown = Object.keys(token.value).filter((mode) => !tokens.modes.includes(mode));
      if (missing.length) error('mode-missing', `"${key}" has no value for ${missing.map((mode) => `"${mode}"`).join(', ')}.`, `Give it one, e.g. "${kind.command} --set \\"${key}=…\\" --mode ${missing[0]}", or one value for all modes.`);
      if (unknown.length) error('mode-unknown', `"${key}" has a value for ${unknown.map((mode) => `"${mode}"`).join(', ')}, which is not a mode.`, `The modes are ${tokens.modes.join(', ')} ("${MODES_KEY}").`);
    }
    for (const value of values) {
      if (hasReference(value) || !kind.checkValue) continue;
      const checked = kind.checkValue(value, token.group);
      if (typeof checked === 'object') error('value-invalid', `"${key}" can't be "${value}": ${checked.error}`, 'Give it a valid value, or a reference to another token.');
    }
    for (const reference of tokenReferences(token.value)) {
      if (!findToken(found, reference)) error('reference-unknown', `"${key}" refers to {${reference.join('.')}}, which is not a token.`, 'Refer to an existing token, or add it first.');
    }
  }
  // Loops of references: a token that, through others, refers to itself.
  const edges = new Map(found.map((token) => [token.path.join('.'), tokenReferences(token.value).map((reference) => findToken(found, reference)?.path.join('.')).filter((target): target is string => !!target)]));
  const reported = new Set<string>();
  const visit = (key: string, trail: string[]): void => {
    if (trail.includes(key)) {
      const loop = [...trail.slice(trail.indexOf(key)), key];
      if (!loop.some((step) => reported.has(step))) error('reference-loop', `Tokens refer to each other in a loop: ${loop.join(' → ')}.`, 'Give one of them a value.');
      loop.forEach((step) => reported.add(step));
      return;
    }
    for (const next of edges.get(key) ?? []) visit(next, [...trail, key]);
  };
  for (const key of edges.keys()) visit(key, []);
  return issues;
}

/** A value as CSS: references become variables, "{brand.800}" → "var(--color-brand-800)". */
function cssOf(text: string, found: Token[]): string {
  return text.replace(REFERENCE, (match, reference: string) => {
    const token = findToken(found, reference.split(/[/.]/).map((segment) => segment.trim()));
    return token ? `var(${token.variable})` : match;
  });
}

/**
 * The CSS of a kind: one variable per token, in :root (or Tailwind's @theme). Light and dark values are one
 * light-dark() value; the base mode is "light", or the first; a mode with a media query sets its values in it; any
 * other mode sets its values under [data-theme="<mode>"].
 */
export function tokensCss(kind: TokenKind, tokens: Tokens, library: StyleLibrary): string {
  const found = allTokens(kind, tokens);
  const lightDark = tokens.modes.includes('light') && tokens.modes.includes('dark');
  const base = tokens.modes.includes('light') ? 'light' : tokens.modes[0]!;
  const others = tokens.modes.filter((mode) => mode !== base && !(lightDark && mode === 'dark'));
  const value = (token: Token): string => {
    if (typeof token.value === 'string') return cssOf(token.value, found);
    const first = cssOf(token.value[base] ?? Object.values(token.value)[0]!, found);
    const dark = lightDark && token.value.dark !== undefined ? cssOf(token.value.dark, found) : undefined;
    return dark && dark !== first ? `light-dark(${first}, ${dark})` : first;
  };
  const lines: string[] = [];
  let group: string | undefined;
  for (const token of found) {
    if (group !== undefined && token.path[0] !== group) lines.push('');
    group = token.path[0];
    lines.push(`  ${token.variable}: ${value(token)};`);
  }
  const header = `/* ${kind.file[0]!.toUpperCase()}${kind.file.slice(1)}, written from ${kind.file}.json by "reactsmith ${kind.command}": change ${kind.file}.json or use the command, not this file. */`;
  const blocks = [`${library === 'tailwind' ? '@theme' : ':root'} {\n${lines.join('\n')}\n}`];
  for (const mode of others) {
    const set = found.filter((token) => typeof token.value === 'object' && token.value[mode] !== undefined && token.value[mode] !== token.value[base]);
    if (set.length === 0) continue;
    const declarations = set.map((token) => `${token.variable}: ${cssOf((token.value as Record<string, string>)[mode]!, found)};`);
    const query = tokens.media[mode];
    blocks.push(query ? `@media ${query} {\n  :root {\n${declarations.map((line) => `    ${line}`).join('\n')}\n  }\n}` : `[data-theme="${mode}"] {\n${declarations.map((line) => `  ${line}`).join('\n')}\n}`);
  }
  return `${header}\n${blocks.join('\n\n')}\n`;
}

/** The TypeScript of a kind: the token names, and their types. */
export function tokensTs(kind: TokenKind, tokens: Tokens): string {
  const found = allTokens(kind, tokens);
  const header = `// ${kind.file[0]!.toUpperCase()}${kind.file.slice(1)} tokens, written from ${kind.file}.json by "reactsmith ${kind.command}".`;
  const list = (names: string[], indent: string) => `[\n${names.map((name) => `${indent}  '${name}',`).join('\n')}\n${indent}]`;
  if (!kind.groups) {
    return [header, `export const ${kind.constName} = ${list(found.map((token) => token.name), '')} as const;`, '', `export type ${kind.typeName} = (typeof ${kind.constName})[number];`, ''].join('\n');
  }
  const groups = Object.keys(kind.groups);
  const body = groups.map((group) => `  '${group}': ${list(found.filter((token) => token.group === group).map((token) => token.name), '  ')},`).join('\n');
  const types = groups.map((group) => `export type ${kind.groups![group]!.type} = (typeof ${kind.constName})['${group}'][number];`);
  return [header, `export const ${kind.constName} = {\n${body}\n} as const;`, '', ...types, ''].join('\n');
}

/** The group a path points into, created on the way; a token on the way becomes the "default" of a new group. */
function groupFor(tokens: Tokens, keys: string[]): TokenTree {
  let tree = tokens.tree;
  for (const key of keys) {
    const inner = tree[key];
    if (inner === undefined) tree[key] = {};
    else if (!isGroup(inner, tokens.modes)) tree[key] = { default: inner as TokenValue };
    tree = tree[key] as TokenTree;
  }
  return tree;
}

/**
 * Sets a token: its value for every mode, or with `mode` for that mode only. A new token is added. Setting a group
 * is refused: its tokens are set one by one.
 */
export function setToken(kind: TokenKind, tokens: Tokens, keys: string[], value: string, mode?: string): void {
  const key = keys.join('.');
  if (mode !== undefined && !tokens.modes.includes(mode)) throw tokensError(`${kind.code}-mode-unknown`, `"${mode}" is not a mode.`, `The modes are ${tokens.modes.join(', ')}.`);
  if (kind.groups && !(keys[0]! in kind.groups)) throw tokensError(`${kind.code}-group-unknown`, `"${keys[0]}" is not a group of ${kind.file}.`, `Start the path with one of ${Object.keys(kind.groups).join(', ')}, e.g. "${Object.keys(kind.groups)[0]}/${keys.join('/')}".`);
  if (kind.groups && keys.length < 2) throw tokensError(`${kind.code}-path-group`, `"${key}" is a group of ${kind.file}, not a token.`, `Give the token a name in it, e.g. "${key}/base".`);
  const parent = groupFor(tokens, keys.slice(0, -1));
  const last = keys[keys.length - 1]!;
  const current = parent[last];
  if (isGroup(current, tokens.modes)) {
    if ('default' in current) return setToken(kind, tokens, [...keys, 'default'], value, mode);
    throw tokensError(`${kind.code}-path-group`, `"${key}" is a group, not a token.`, `Set one of its tokens, e.g. "${key}/${Object.keys(current)[0]}".`);
  }
  if (mode === undefined) parent[last] = value;
  else if (current === undefined && tokens.modes.length > 1) {
    throw tokensError(`${kind.code}-mode-new`, `"${key}" is new: it needs a value for every mode, not only "${mode}".`, 'Set it without --mode first, then set each mode.');
  } else {
    const values: Record<string, string> = typeof current === 'object' ? { ...(current as Record<string, string>) } : Object.fromEntries(tokens.modes.map((each) => [each, current ?? value]));
    values[mode] = value;
    parent[last] = Object.values(values).every((each) => each === value) ? value : values;
  }
}

/** Removes a token or a group, and the groups it leaves empty. Returns the tokens removed. */
export function removeToken(kind: TokenKind, tokens: Tokens, keys: string[]): Token[] {
  const key = keys.join('.');
  const removed = allTokens(kind, tokens).filter((token) => token.path.join('.') === key || token.path.join('.').startsWith(`${key}.`));
  if (removed.length === 0) throw tokensError(`${kind.code}-missing`, `There is no token "${key}" in ${kind.file}.`, `Check the path in ${kind.file}.json.`);
  const trail: TokenTree[] = [tokens.tree];
  for (const segment of keys.slice(0, -1)) trail.push(trail[trail.length - 1]![segment] as TokenTree);
  delete trail[trail.length - 1]![keys[keys.length - 1]!];
  for (let depth = trail.length - 1; depth > 0; depth--) {
    if (Object.keys(trail[depth]!).length === 0) delete trail[depth - 1]![keys[depth - 1]!];
  }
  return removed;
}

/** The prefixes of a kind's variables: "--color-", or one per group. */
function prefixes(kind: TokenKind): string[] {
  return kind.groups ? Object.values(kind.groups).map((group) => group.prefix) : [kind.prefix!];
}

/** The variables of a kind that a text uses: "var(--color-primary)" → "--color-primary". */
function usedVariables(kind: TokenKind, text: string): string[] {
  const starts = prefixes(kind);
  return [...new Set([...text.matchAll(VARIABLE_USE)].map((match) => match[1]!))].filter((variable) => starts.some((start) => variable.startsWith(start)));
}

/** The variables the project's stylesheets declare outside the tokens folder: "--text-h: #08060d;" → "--text-h". */
async function declaredVariables(kind: TokenKind, read: (fileRel: string) => Promise<string | undefined>, root: string, config: ResolvedConfig): Promise<Set<string>> {
  const declared = new Set<string>();
  const tokensDir = tokensPaths(config, kind)?.dir;
  for (const file of await listFiles(path.join(root, config.srcDir)).catch(() => [])) {
    const fileRel = toRelative(root, file);
    if (!fileRel.endsWith('.css') || (tokensDir && fileRel.startsWith(`${tokensDir}/`))) continue;
    for (const match of ((await read(fileRel)) ?? '').matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)) declared.add(match[1]!);
  }
  return declared;
}

/** The uses of a kind's variables in the project's styles and code, by variable, outside the tokens folder. */
export async function tokenUsages(kind: TokenKind, read: (fileRel: string) => Promise<string | undefined>, root: string, config: ResolvedConfig): Promise<Map<string, string[]>> {
  const usages = new Map<string, string[]>();
  const tokensDir = tokensPaths(config, kind)?.dir;
  for (const file of await listFiles(path.join(root, config.srcDir)).catch(() => [])) {
    const fileRel = toRelative(root, file);
    if (!/\.(css|tsx?)$/.test(fileRel) || (tokensDir && fileRel.startsWith(`${tokensDir}/`))) continue;
    for (const variable of usedVariables(kind, (await read(fileRel)) ?? '')) usages.set(variable, [...(usages.get(variable) ?? []), fileRel]);
  }
  return usages;
}

/** The variables of a kind that a style uses and that are not tokens: "var(--color-brand)" when there is no brand. */
export function unknownVariables(kind: TokenKind, text: string, tokens: Tokens): string[] {
  const known = new Set(allTokens(kind, tokens).map((token) => token.variable));
  return usedVariables(kind, text).filter((variable) => !known.has(variable));
}

/** A kind's tokens in the project, or undefined when it has no <kind>.json yet. */
export async function readTokens(kind: TokenKind, read: (fileRel: string) => Promise<string | undefined>, config: ResolvedConfig): Promise<Tokens | undefined> {
  const paths = tokensPaths(config, kind);
  const text = paths && (await read(paths.json));
  return text === undefined || !paths ? undefined : parseTokens(kind, text, paths.json);
}

/** The refusal for variables a style uses that are not tokens of the kind. */
export function unknownVariablesError(kind: TokenKind, unknown: string[], fileRel?: string): IssueError {
  return tokensError(
    `${kind.code}-unknown`,
    `${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not in ${TOKENS_FOLDER}/${kind.file}.json.`,
    `Use a token of ${TOKENS_FOLDER}/${kind.file}.json, or add it first with "${kind.command} --set".`,
    fileRel,
  );
}

/** A value for --set: references and expressions as written, plain values checked by the kind. */
export function tokenValue(kind: TokenKind, text: string, keys: string[]): string {
  const value = text.trim();
  if (!value || /[;{}]/.test(value.replace(REFERENCE, ''))) throw tokensError(`${kind.code}-invalid`, `"${keys.join('/')}" can't be "${value}".`, 'Give a value, a token ("{a.b}") or a CSS expression.');
  if (hasReference(value) || !kind.checkValue) return value;
  const checked = kind.checkValue(value, kind.groups ? keys[0] : undefined);
  if (typeof checked === 'object') throw tokensError(`${kind.code}-invalid`, `"${keys.join('/')}" can't be "${value}": ${checked.error}`, 'Give a valid value, or a reference to another token.');
  return checked;
}

/** "a/b=#fff; c.d={a.b}" → [["a/b", "#fff"], ["c.d", "{a.b}"]]. */
export function assignments(kind: TokenKind, text: string): [string, string][] {
  return text.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const equals = part.indexOf('=');
    if (equals <= 0) throw tokensError(`${kind.code}-set-invalid`, `"${part}" is not "path=value".`, `E.g. --set "${kind.groups ? `${Object.keys(kind.groups)[0]}/base` : 'text/default/secondary'}=…".`);
    return [part.slice(0, equals).trim(), part.slice(equals + 1).trim()];
  });
}

export interface TokensEdit {
  /** Changes the hierarchy; returns what changed, for the summary. */
  (tokens: Tokens): string[];
}

/** What --set, --mode and --remove do, in order, as one edit. Removing is refused while a style or another token uses it. */
export function setAndRemove(kind: TokenKind, given: { set?: string; mode?: string; remove?: string }, usages: Map<string, string[]>): { edit: TokensEdit; any: boolean } {
  const sets = given.set === undefined ? [] : assignments(kind, given.set).map(([keys, value]) => ({ keys: tokenPath(keys), value: tokenValue(kind, value, tokenPath(keys)) }));
  const removes = (given.remove ?? '').split(';').map((keys) => keys.trim()).filter(Boolean).map(tokenPath);
  if (given.mode !== undefined && sets.length === 0) throw tokensError('options-conflict', '--mode applies to the --set values.', `Pass the values with --set, e.g. --set "…=…" --mode ${kind.defaultModes[1] ?? kind.defaultModes[0]}.`);
  const edit: TokensEdit = (tokens) => {
    const done: string[] = [];
    for (const { keys, value } of sets) done.push(...labelIfChanged(tokens, keys.join('/'), () => setToken(kind, tokens, keys, value, given.mode)));
    for (const keys of removes) {
      const removed = removeToken(kind, tokens, keys);
      const users = removed.flatMap((token) => usages.get(token.variable) ?? []);
      if (users.length) throw tokensError(`${kind.code}-in-use`, `"${keys.join('/')}" is still used in ${[...new Set(users)].join(', ')}.`, 'Change those styles to another token first.');
      const rest = allTokens(kind, tokens);
      const referrers = rest.filter((token) => tokenReferences(token.value).some((reference) => !findToken(rest, reference) && findToken(removed, reference)));
      if (referrers.length) throw tokensError(`${kind.code}-in-use`, `"${keys.join('/')}" is still used by ${referrers.map((token) => `"${token.path.join('/')}"`).join(', ')}.`, 'Give those tokens another value first.');
      done.push(`removed ${keys.join('/')}`);
    }
    return done;
  };
  return { edit, any: sets.length > 0 || removes.length > 0 };
}

/** Runs one change, and returns its label when it changed something. */
export function labelIfChanged(tokens: Tokens, label: string, apply: () => void): string[] {
  const before = JSON.stringify(tokens);
  apply();
  return JSON.stringify(tokens) !== before ? [label] : [];
}

/**
 * Plans a kind's files: reads <kind>.json (or moves an older file into it, or starts from the defaults), applies
 * `edit`, checks the result, and writes <kind>.json, <kind>.css and <kind>.ts where they differ.
 */
export async function planTokens(changes: ChangeSet, config: ResolvedConfig, kind: TokenKind, edit?: TokensEdit, force = false): Promise<string[]> {
  const paths = tokensPaths(config, kind);
  if (!paths) throw tokensError('styles-disabled', `The ${kind.file} need the app styles folder.`, 'Set "folders.app" and "appFolders.styles" in the config.');
  const jsonText = await changes.read(paths.json);
  let tokens: Tokens;
  if (jsonText !== undefined) tokens = parseTokens(kind, jsonText, paths.json);
  else {
    const migrated = kind.migrate ? await kind.migrate(changes, config, edit !== undefined, force) : undefined;
    if (migrated === 'kept') return [];
    tokens = migrated ?? kind.defaults();
  }

  const changed = edit ? edit(tokens) : [];
  const issues = tokensIssues(kind, tokens, paths.json);
  if (issues.length) throw new IssueError(issues);

  const write = async (fileRel: string, content: string, label: string) => {
    const current = await changes.read(fileRel);
    if (current === undefined) changes.write(fileRel, content, { type: 'create', message: label });
    else if (current !== content) changes.write(fileRel, content, { type: 'update', message: changed.length ? `${label}: ${changed.join(', ')}` : `${label} rewritten` });
    else changes.skip(fileRel, `${label} unchanged`);
  };
  // <kind>.json keeps its own formatting until a command changes it.
  if (jsonText === undefined || changed.length) await write(paths.json, serializeTokens(tokens), kind.file);
  await write(paths.css, tokensCss(kind, tokens, config.styles), `${kind.file} variables`);
  await write(paths.ts, tokensTs(kind, tokens), `${kind.file} token type`);
  return changed;
}

/** Checks a kind in the project: <kind>.json valid, its generated files current, and every variable of the kind the styles use a token. */
export async function checkTokens(kind: TokenKind, root: string, config: ResolvedConfig, read: (fileRel: string) => Promise<string | undefined>): Promise<Issue[]> {
  const paths = tokensPaths(config, kind);
  if (!paths) return [];
  const jsonText = await read(paths.json);
  if (jsonText === undefined) {
    const legacy = kind.legacyIssue ? await kind.legacyIssue(read, config) : undefined;
    return legacy ? [legacy] : [];
  }
  let tokens: Tokens;
  try {
    tokens = parseTokens(kind, jsonText, paths.json);
  } catch (error) {
    if (error instanceof IssueError) return error.issues;
    throw error;
  }
  const issues = tokensIssues(kind, tokens, paths.json);
  if (issues.length) return issues;
  for (const [fileRel, expected] of [[paths.css, tokensCss(kind, tokens, config.styles)], [paths.ts, tokensTs(kind, tokens)]] as const) {
    if ((await read(fileRel)) !== expected) {
      issues.push({ severity: 'error', code: `${kind.file}-stale`, path: fileRel, message: `${fileRel} doesn't match ${paths.json}.`, hint: `It is written from ${kind.file}.json: run "${kind.command}" to write it again.` });
    }
  }
  // A variable the project's own stylesheets declare ("--text-h: #08060d", as in the Vite starter) is not a missing token.
  const known = new Set([...allTokens(kind, tokens).map((token) => token.variable), ...(await declaredVariables(kind, read, root, config))]);
  for (const [variable, files] of await tokenUsages(kind, read, root, config)) {
    if (known.has(variable)) continue;
    for (const fileRel of files) {
      issues.push({ severity: 'error', code: `${kind.code}-unknown`, path: fileRel, message: `${variable} is not in ${TOKENS_FOLDER}/${kind.file}.json.`, hint: `Use a token of ${paths.json}, or add it with "${kind.command} --set".` });
    }
  }
  return issues;
}

/** The global stylesheet, where the tokens lived before they had their own files. */
export const globalCssPath = (config: ResolvedConfig) => `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/global.css`;

/**
 * Takes the variables a pattern matches out of global.css ("--space-2: 0.5rem;"): their values by the pattern's
 * first group ("2", or "default" without one), with the change that removes them, its blank lines tidied and a
 * Tailwind @theme it leaves empty removed. Undefined when global.css has none.
 */
export async function takeFromGlobalCss(changes: ChangeSet, config: ResolvedConfig, pattern: RegExp, kind: TokenKind): Promise<Record<string, string> | undefined> {
  const stylesRel = globalCssPath(config);
  const text = await changes.read(stylesRel);
  if (text === undefined) return undefined;
  const found: Record<string, string> = {};
  for (const match of text.matchAll(pattern)) found[match[1] ?? 'default'] = match[2]!;
  if (Object.keys(found).length === 0) return undefined;
  const rest = text
    .replace(pattern, '')
    .replace(/@theme\s*\{\s*\}\s*\n?/, '')
    .replace(/\{\n(\s*\n)+/g, '{\n')
    .replace(/\n(\s*\n)+(\s*\})/g, '\n$2')
    .replace(/\n(\s*\n){2,}/g, '\n\n');
  changes.write(stylesRel, rest, { type: 'update', message: `${kind.file} moved to ${tokensPaths(config, kind)!.json}` });
  return found;
}

/** Whether global.css still holds variables a pattern matches, for the warning of a kind not moved yet. */
export async function globalCssHolds(read: (fileRel: string) => Promise<string | undefined>, config: ResolvedConfig, pattern: RegExp): Promise<boolean> {
  const text = await read(globalCssPath(config));
  return !!text && new RegExp(pattern.source, 'm').test(text);
}

/** The import of a kind's CSS in the global styles, relative to them. */
export const tokensImport = (kind: TokenKind) => `@import './${TOKENS_FOLDER}/${kind.file}.css';`;
