import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE, TOOL_NAME } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { listFiles, toRelative } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { breakpointVariant, globalStylesPath } from '../../../styles/global.js';
import { TOKENS_FOLDER } from '../../../tokens/engine.js';

/** A media query on the screen size: the ones the breakpoints are for. Print, motion or color scheme queries are not. */
const SCREEN_QUERY = /\b(min-|max-)?(width|height)\s*:/;

/** "mobile ((max-width: 767px))" for each breakpoint. */
function breakpointList(config: ResolvedConfig): string {
  return Object.entries(config.breakpoints).map(([name, query]) => `${name} ${query}`).join(', ');
}

/**
 * The screen sizes are the breakpoints of the config, the same in every file: with CSS Modules, a style file's
 * media query on the screen size is one of them; with Tailwind, the global stylesheet has the variant of each.
 */
export async function breakpointIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (config.styles === 'tailwind') return variantIssues(root, config);
  const known = new Set(Object.values(config.breakpoints));
  const issues: Issue[] = [];
  const tokensDir = `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/${TOKENS_FOLDER}/`;
  for (const file of (await listFiles(path.join(root, config.srcDir)).catch(() => [])).sort()) {
    const fileRel = toRelative(root, file);
    // The tokens' CSS is written from the breakpoints; global.css and other stylesheets are the dev's to shape.
    if (!fileRel.endsWith('.module.css') || fileRel.startsWith(tokensDir)) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    for (const match of text.matchAll(/@media\s+([^{]+?)\s*\{/g)) {
      const query = match[1]!.trim();
      if (!SCREEN_QUERY.test(query) || known.has(query)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      issues.push({
        severity: 'warning',
        code: 'breakpoint-unknown',
        path: fileRel,
        message: `@media ${query} (line ${line}) is not a breakpoint, so this style changes at its own screen size.`,
        hint: `Use a breakpoint with "style update <element> --at <breakpoint>"${known.size ? ` (${breakpointList(config)})` : ''}, or add this one to "breakpoints" in ${CONFIG_FILE}.`,
      });
    }
  }
  return issues;
}

/** With Tailwind, each breakpoint is a variant of the global stylesheet, with the query of the config. */
async function variantIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const stylesRel = globalStylesPath(config);
  const text = stylesRel ? await readFile(path.join(root, stylesRel), 'utf8').catch(() => undefined) : undefined;
  if (!stylesRel || text === undefined) return [];
  return Object.entries(config.breakpoints)
    .filter(([name, query]) => !text.includes(breakpointVariant(name, query)))
    .map(([name, query]) => ({
      severity: 'warning' as const,
      code: 'breakpoint-variant-missing',
      path: stylesRel,
      message: `${stylesRel} has no variant for the breakpoint "${name}" ${query}, so "${name}:" classes do nothing.`,
      hint: `Run "${TOOL_NAME} init" to write it: ${breakpointVariant(name, query)}`,
    }));
}
