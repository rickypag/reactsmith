import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { listUnits } from '../tree/list-units.js';
import { componentFileProblems, viewEntryProblems } from './component-file.js';
import { componentStyleIssues } from './component-styles.js';
import { inlineStyleIssues } from './inline-styles.js';
import { plainLinkIssues } from './links.js';
import { tableNestingIssues } from '../elements/table.js';
import { listShapeIssues } from './lists.js';
import { textPlacementIssues } from './text.js';

const VIEW_FILE_HINT =
  'A view file holds only the view (an arrow function typed React.FC) and, if needed, its props interface. ' +
  "Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.";

async function readOptional(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

/**
 * The content checks of every view folder, until the content rules take them: the view file and the entry point.
 * Where the folders are and what is in them is the views rule's.
 */
export async function checkViewContents(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  for (const unit of await listUnits(root, config)) {
    if (unit.kind !== 'view') continue;
    const { name: viewName, folderRel: entryRel } = unit;
    const viewRel = `${entryRel}/${viewName}.tsx`;
    const viewText = await readOptional(path.join(root, viewRel));
    if (viewText !== undefined) {
      issues.push(...textPlacementIssues(root, config, viewRel, viewText), ...listShapeIssues(viewRel, viewText), ...plainLinkIssues(config, viewRel, viewText), ...tableNestingIssues(viewRel, viewText), ...inlineStyleIssues(config, viewRel, viewText));
      issues.push(...(await componentStyleIssues(root, config, viewRel, viewText)));
      for (const problem of componentFileProblems(viewText, `${viewName}.tsx`, viewName)) {
        issues.push({ severity: 'error', code: 'view-file-content', path: viewRel, message: problem, hint: VIEW_FILE_HINT });
      }
    }

    const entryFileRel = `${entryRel}/index.ts`;
    const entryText = await readOptional(path.join(root, entryFileRel));
    for (const problem of entryText === undefined ? [] : viewEntryProblems(entryText, 'index.ts')) {
      issues.push({
        severity: 'error',
        code: 'view-entry-invalid',
        path: entryFileRel,
        message: problem,
        hint: `It should only contain "export { ${viewName} as Component } from './${viewName}';" (and the loader, if any).`,
      });
    }

  }
}
