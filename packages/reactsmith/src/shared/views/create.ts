import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { toPascalCase, toTitle } from '../naming.js';
import { renderTemplate } from '../templates/render.js';

/** "user-profile" → "UserProfileView", with the configured suffix. */
export function viewNameFor(name: string, config: ResolvedConfig): string {
  return `${toPascalCase(name)}${config.viewSuffix}`;
}

/**
 * Plans a view folder: `<viewsDir>/<ViewName>/<ViewName>.tsx` and its `index.ts`,
 * which exports the view as `Component` for React Router's lazy routes.
 */
export async function planViewCreate(changes: ChangeSet, viewsDirRel: string, viewName: string, title = toTitle(viewName)): Promise<void> {
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
  const values = { viewName, title };
  changes.write(`${dirRel}/${viewName}.tsx`, await renderTemplate('view/View.tsx', values), { type: 'create', message: 'view' });
  changes.write(`${dirRel}/index.ts`, await renderTemplate('view/index.ts', values), { type: 'create', message: 'view entry point' });
}
