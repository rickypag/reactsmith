import type { Dirent } from 'node:fs';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import type { TreeUnit } from '../../../tree/types.js';
import { API_FOLDER } from '../../api.js';
import { styleFileOf, unitEntryIssues } from '../unit-entries.js';
import { unitComponents } from '../unit-files.js';

/** Files a component folder may hold besides its component files and their styles. */
const COMPONENT_EXTRA_FILES = ['index.ts', 'types.ts', 'utils.ts', 'constants.ts'] as const;

/**
 * The component folder holds only its component files (Name, NameContent, NameSkeleton), the style file of each one
 * it has, index.ts, types.ts, utils.ts, constants.ts, and the folders api/, tests/ and stories/.
 */
export function unexpectedEntryIssues(config: ResolvedConfig, unit: TreeUnit, entries: Dirent[], files: Set<string>): Issue[] {
  const components = unitComponents(unit).map((component) => `${component}.tsx`);
  const styles = components.filter((file) => files.has(file)).map((file) => styleFileOf(config, file));
  return unitEntryIssues(config, unit, entries, {
    code: 'component-unexpected-file',
    files: [...components, ...styles, ...COMPONENT_EXTRA_FILES],
    folders: [API_FOLDER],
    fileHint:
      `A component folder holds ${components.join(', ')}, their style files and ${COMPONENT_EXTRA_FILES.join(', ')}. ` +
      'Move other code into one of them, or into its own component.',
    folderHint: "Move its code into the component's files, or into its own component.",
  });
}
