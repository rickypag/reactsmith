import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig, StyleLibrary } from '../config/types.js';
import { COLORS, LEGACY_PALETTE_IMPORT } from '../tokens/colors.js';
import { planTokens, tokensImport, tokensPaths } from '../tokens/engine.js';
import { TOKEN_KINDS } from '../tokens/kinds.js';

/** The app's global stylesheet, in the app's styles folder, imported once by the App component. */
export const GLOBAL_STYLES_FILE = 'global.css';

export { SPACE_STEPS } from '../tokens/sizes.js';

/** Each area of the design lives in its own file in tokens/, which global.css imports. */
const TOKEN_IMPORTS = TOKEN_KINDS.map(tokensImport).join('\n');

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map((line) => (line ? `  ${line}` : '')).join('\n')}\n}\n`;

/**
 * The design tokens and a small reset; the colors, typography, spacing and radius come from tokens/. With CSS Modules, components use
 * the tokens as variables: "border: 1px solid var(--color-border)". With Tailwind, they are theme values: "border-border".
 */
export function globalStylesContent(library: StyleLibrary): string {
  const header = '/* Global styles: design tokens and a small reset. Component styles live next to each component. */\n';
  if (library === 'tailwind') {
    return [
      header,
      `@import "tailwindcss";\n${TOKEN_IMPORTS}\n`,
      block(':root', ['color-scheme: light dark;']),
      block('body', ['color: var(--color-text);', 'background: var(--color-bg);']),
    ].join('\n');
  }
  return [
    header,
    `${TOKEN_IMPORTS}\n`,
    block(':root', ['color-scheme: light dark;']),
    block('*,\n*::before,\n*::after', ['box-sizing: border-box;']),
    block('body', ['margin: 0;', 'font-family: var(--font-sans);', 'line-height: 1.5;', 'color: var(--color-text);', 'background: var(--color-bg);']),
  ].join('\n');
}

/** Project-relative path of the global stylesheet, or undefined when the app or its styles folder is disabled. */
export function globalStylesPath(config: ResolvedConfig): string | undefined {
  if (!config.folders.app || !config.appFolders.styles) return undefined;
  return `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/${GLOBAL_STYLES_FILE}`;
}

/**
 * Plans importing each kind of tokens in the global styles, when its CSS exists and they don't import it yet: the
 * colors in place of the old palette.css import, the others after the token imports before them, after Tailwind's
 * import, which must come first, or at the top.
 */
export async function planTokenImports(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  const stylesRel = globalStylesPath(config);
  let text = stylesRel ? await changes.read(stylesRel) : undefined;
  if (!stylesRel || text === undefined) return;
  const added: string[] = [];
  for (const kind of TOKEN_KINDS) {
    const line = tokensImport(kind);
    // A kind not written yet (a palette kept because it was changed by hand) keeps what the file imports now.
    const cssRel = tokensPaths(config, kind)?.css;
    if (text.includes(line) || !cssRel || (await changes.read(cssRel)) === undefined) continue;
    added.push(`${kind.file}.css`);
    if (kind === COLORS && LEGACY_PALETTE_IMPORT.test(text)) {
      text = text.replace(LEGACY_PALETTE_IMPORT, line);
      continue;
    }
    const current: string = text;
    const previous: RegExpMatchArray | undefined = [...current.matchAll(/^@import\s+['"]\.\/tokens\/[^'"]+['"];?[ \t]*\r?\n/gm)].pop();
    const tailwind = /^@import\s+["']tailwindcss["'];?[ \t]*\r?\n/m.exec(current);
    const after = previous ?? tailwind;
    const at: number = after ? after.index! + after[0].length : 0;
    text = `${text.slice(0, at)}${line}\n${after ? '' : '\n'}${text.slice(at)}`;
  }
  if (added.length) changes.write(stylesRel, text, { type: 'update', message: `imports ${added.map((file) => `tokens/${file}`).join(' and ')}` });
}

/** The Tailwind variant of a breakpoint, so "mobile:hidden" applies under its media query. */
export function breakpointVariant(name: string, query: string): string {
  return `@custom-variant ${name} (@media ${query});`;
}

const VARIANT_LINE = (name: string) => new RegExp(`^@custom-variant\\s+${name}\\s*\\(.*\\);?[ \\t]*$`, 'm');

/**
 * With Tailwind, plans a variant per breakpoint in the global stylesheet, after its imports: added when missing, its
 * query updated when the config changed it. Variants of other names are the dev's and stay.
 */
export async function planBreakpointVariants(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  const stylesRel = globalStylesPath(config);
  const text = stylesRel && config.styles === 'tailwind' ? await changes.read(stylesRel) : undefined;
  if (!stylesRel || text === undefined) return;
  let updated = text;
  for (const [name, query] of Object.entries(config.breakpoints)) {
    const line = breakpointVariant(name, query);
    const existing = VARIANT_LINE(name).exec(updated);
    if (existing) {
      updated = updated.replace(existing[0], line);
      continue;
    }
    // After the last variant or import, so it is defined before any rule uses it.
    const anchors = [...updated.matchAll(/^@(import|custom-variant)\b.*$/gm)];
    const after = anchors[anchors.length - 1];
    const at = after ? after.index! + after[0].length : 0;
    updated = after ? `${updated.slice(0, at)}\n${line}${updated.slice(at)}` : `${line}\n${updated}`;
  }
  if (updated !== text) changes.write(stylesRel, updated, { type: 'update', message: 'the variants of the breakpoints' });
}

/** Plans the global stylesheet and the default tokens when they do not exist yet. Returns the stylesheet's path. */
export async function planGlobalStyles(changes: ChangeSet, config: ResolvedConfig): Promise<string | undefined> {
  const stylesRel = globalStylesPath(config);
  if (!stylesRel) return undefined;
  if ((await changes.read(stylesRel)) !== undefined) {
    changes.skip(stylesRel, 'global styles already exist');
  } else {
    changes.write(stylesRel, globalStylesContent(config.styles), { type: 'create', message: 'global styles: design tokens and a reset' });
  }
  for (const kind of TOKEN_KINDS) await planTokens(changes, config, kind);
  await planTokenImports(changes, config);
  await planBreakpointVariants(changes, config);
  return stylesRel;
}
