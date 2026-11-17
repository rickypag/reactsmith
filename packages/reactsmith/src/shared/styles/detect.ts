import { parse } from 'jsonc-parser';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE, TOOL_NAME } from '../config/defaults.js';
import type { StyleLibrary } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';
import { IssueError, type Issue } from '../issues.js';

export interface StylesDecision {
  /** The library to save in the config; undefined when the config already sets it, or nothing needs saving. */
  styles?: StyleLibrary;
  /** What the person should know about the choice, e.g. that Tailwind is installed but not used for the styles. */
  notes: Issue[];
}

/**
 * How the commands write styles. Tailwind being installed doesn't decide it: create-next-app installs Tailwind by
 * default, whether or not anyone chose it. So, unless the config or `requested` says, a project with Tailwind is asked,
 * CSS Modules being the recommended answer; when nobody can be asked, it gets CSS Modules and a note saying how to
 * choose Tailwind. The choice is saved, so the question comes once.
 */
export async function planStylesDecision(changes: ChangeSet, requested: StyleLibrary | undefined, confirm: ((question: string) => Promise<boolean>) | undefined): Promise<StylesDecision> {
  const text = await changes.read(CONFIG_FILE);
  const raw: unknown = text === undefined ? undefined : parse(text);
  const current = typeof raw === 'object' && raw !== null && 'styles' in raw ? (raw as { styles: StyleLibrary }).styles : undefined;
  if (current !== undefined) {
    if (requested !== undefined && requested !== current) {
      throw new IssueError({
        severity: 'error',
        code: 'styles-conflict',
        path: CONFIG_FILE,
        message: `${CONFIG_FILE} already sets "styles" to "${current}", but "${requested}" was requested.`,
        hint: `Existing styles are converted with "${TOOL_NAME} style convert --to ${requested}", which also updates the config.`,
      });
    }
    return { notes: [] };
  }
  if (requested !== undefined) return { styles: requested, notes: [] };
  if ((await dependencyMajor(changes.root, 'tailwindcss')) === undefined) return { notes: [] };

  if (confirm) {
    const tailwind = await confirm('Tailwind is installed. Write the styles as Tailwind classes (Name.styles.ts) instead of CSS Modules (Name.module.css, plain CSS: recommended)?');
    return { styles: tailwind ? 'tailwind' : 'css-modules', notes: [] };
  }
  return {
    styles: 'css-modules',
    notes: [
      {
        severity: 'warning',
        code: 'styles-tailwind-installed',
        path: CONFIG_FILE,
        message: 'Tailwind is installed, but the styles are written as CSS Modules (Name.module.css): plain CSS, one rule per style.',
        hint: `To write Tailwind classes instead, set "styles": "tailwind" in ${CONFIG_FILE} before any style is written.`,
      },
    ],
  };
}
