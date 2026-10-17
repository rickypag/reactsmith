import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { toPascalCase, toTitle } from '../naming.js';
import { renderTemplate } from '../templates/render.js';

/** "settings", "Settings" or "SettingsView" → "SettingsView", with the configured suffix. */
export function viewNameFor(name: string, config: ResolvedConfig): string {
  const pascal = toPascalCase(name);
  return config.viewSuffix && pascal.endsWith(config.viewSuffix) ? pascal : `${pascal}${config.viewSuffix}`;
}

/** "SettingsView" → "Settings": the page name, without the suffix. */
export function pageNameOf(viewName: string, config: ResolvedConfig): string {
  const suffix = config.viewSuffix;
  return suffix && viewName.endsWith(suffix) && viewName !== suffix ? viewName.slice(0, -suffix.length) : viewName;
}

export interface ViewCreateOptions {
  /** Heading of the generated view. Defaults to the view name in words. */
  title?: string;
  /** Also create a loader.ts, exported from the view's entry point. */
  loader?: boolean;
}

/**
 * Plans a view folder: `<viewsDir>/<ViewName>/<ViewName>.tsx` and its `index.ts`,
 * which exports the view as `Component` (and the loader, if any) for React Router's lazy routes.
 */
export async function planViewCreate(
  changes: ChangeSet,
  viewsDirRel: string,
  viewName: string,
  options: ViewCreateOptions = {},
): Promise<void> {
  const dirRel = `${viewsDirRel}/${viewName}`;
  if (await stat(changes.resolve(dirRel)).catch(() => undefined)) {
    throw new IssueError({
      severity: 'error',
      code: 'view-exists',
      path: dirRel,
      message: `View "${viewName}" already exists.`,
      hint: 'Choose another name.',
    });
  }
  const values = { viewName, title: options.title ?? toTitle(viewName) };
  changes.write(`${dirRel}/${viewName}.tsx`, await renderTemplate('view/View.tsx', values), { type: 'create', message: 'view' });
  const entry = options.loader ? 'view/index-with-loader.ts' : 'view/index.ts';
  changes.write(`${dirRel}/index.ts`, await renderTemplate(entry, values), { type: 'create', message: 'view entry point' });
  if (options.loader) {
    changes.write(`${dirRel}/loader.ts`, await renderTemplate('view/loader.ts', values), { type: 'create', message: 'loader' });
  }
}
