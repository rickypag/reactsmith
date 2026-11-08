import type { Dirent } from 'node:fs';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { styleFileOf, unitEntryIssues } from '../unit-entries.js';
import { partsOf } from './parts-of.js';

/** The layout folder holds only the layout file, its style file, index.ts, and the folders tests/ and stories/. */
export function unexpectedEntryIssues(config: ResolvedConfig, unit: TreeUnit, entries: Dirent[]): Issue[] {
  const layoutFile = `${unit.name}.tsx`;
  const parts = `Put the parts of the layout in ${partsOf(unit)}.`;
  return unitEntryIssues(config, unit, entries, {
    code: 'layout-unexpected-file',
    files: [layoutFile, styleFileOf(config, layoutFile), 'index.ts'],
    folders: [],
    fileHint: `A layout folder holds ${layoutFile}, its style file and index.ts. ${parts}`,
    folderHint: parts,
  });
}
