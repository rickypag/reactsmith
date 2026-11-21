import type { Issue } from '../../../issues.js';
import type { TreeFolder } from '../../../tree/types.js';
import { baseName, misplacedFiles } from './misplaced-files.js';

/** What a folder of units holds, by its `holds`, and the entry point a unit needs. */
const UNITS = {
  views: { holds: 'only view folders', entry: 'an index.ts exporting it as Component' },
  layouts: { holds: 'only layout folders', entry: 'an index.ts exporting it' },
  components: { holds: 'only component folders', entry: 'an index.ts exporting it' },
} as const;

type UnitFolder = TreeFolder & { holds: keyof typeof UNITS };

function isUnitFolder(folder: TreeFolder): folder is UnitFolder {
  return folder.holds in UNITS;
}

/** The folders of views, layouts and components inside a place: no files, one folder per unit. */
export async function unitFolderIssues(root: string, placeRel: string, folders: TreeFolder[]): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const folder of folders.filter(isUnitFolder)) {
    const folderRel = `${placeRel}/${folder.name}`;
    const unit = UNITS[folder.holds];
    issues.push(
      ...(await misplacedFiles(root, {
        folderRel,
        holds: unit.holds,
        allows: () => false,
        hint: (fileName) => `Move it to ${folderRel}/${baseName(fileName)}/${fileName} and add ${unit.entry}.`,
      })),
    );
  }
  return issues;
}
