import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig, StyleLibrary } from '../config/types.js';
import { PALETTE_FILE, planPalette } from './palette.js';

/** The app's global stylesheet, in the app's styles folder, imported once by the App component. */
export const GLOBAL_STYLES_FILE = 'global.css';

/** The spacing steps that have a token, "--space-<step>": the same steps as Tailwind's spacing scale. */
export const SPACE_STEPS = [1, 2, 3, 4, 6, 8] as const;

/** Each area of the design lives in its own file next to global.css, which imports it. */
const PALETTE_IMPORT = `@import './${PALETTE_FILE}';`;

const FONT_TOKENS = ["--font-sans: system-ui, 'Segoe UI', Roboto, sans-serif;", "--font-mono: ui-monospace, 'Cascadia Code', Consolas, monospace;"];

const block = (selector: string, lines: string[]) => `${selector} {\n${lines.map((line) => (line ? `  ${line}` : '')).join('\n')}\n}\n`;

/**
 * Design tokens and a small reset; the colors come from palette.css. With CSS Modules, components use the
 * tokens as variables: "border: 1px solid var(--color-border)". With Tailwind, they are theme values: "border-border".
 */
export function globalStylesContent(library: StyleLibrary): string {
  const header = '/* Global styles: design tokens and a small reset. Component styles live next to each component. */\n';
  if (library === 'tailwind') {
    return [
      header,
      `@import "tailwindcss";\n${PALETTE_IMPORT}\n`,
      block('@theme', FONT_TOKENS),
      block(':root', ['color-scheme: light dark;']),
      block('body', ['color: var(--color-text);', 'background: var(--color-bg);']),
    ].join('\n');
  }
  return [
    header,
    `${PALETTE_IMPORT}\n`,
    block(':root', [
      'color-scheme: light dark;',
      '',
      ...SPACE_STEPS.map((step) => `--space-${step}: ${step * 0.25}rem;`),
      '',
      '--radius: 0.375rem;',
      ...FONT_TOKENS,
    ]),
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
 * Plans importing the palette in the global styles, when they exist and do not import it yet:
 * after Tailwind's import, which must come first, or at the top.
 */
export async function planPaletteImport(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  const stylesRel = globalStylesPath(config);
  const text = stylesRel ? await changes.read(stylesRel) : undefined;
  if (!stylesRel || text === undefined || text.includes(PALETTE_FILE)) return;
  const tailwind = /^@import\s+["']tailwindcss["'];?[ \t]*\r?\n/m.exec(text);
  const at = tailwind ? tailwind.index + tailwind[0].length : 0;
  changes.write(stylesRel, `${text.slice(0, at)}${PALETTE_IMPORT}\n${tailwind ? '' : '\n'}${text.slice(at)}`, {
    type: 'update',
    message: `imported ${PALETTE_FILE}`,
  });
}

/** Plans the global stylesheet and the default palette when they do not exist yet. Returns the stylesheet's path. */
export async function planGlobalStyles(changes: ChangeSet, config: ResolvedConfig): Promise<string | undefined> {
  const stylesRel = globalStylesPath(config);
  if (!stylesRel) return undefined;
  if ((await changes.read(stylesRel)) !== undefined) {
    changes.skip(stylesRel, 'global styles already exist');
  } else {
    changes.write(stylesRel, globalStylesContent(config.styles), { type: 'create', message: 'global styles: design tokens and a reset' });
  }
  await planPalette(changes, config);
  await planPaletteImport(changes, config);
  return stylesRel;
}
