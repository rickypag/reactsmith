import { CONSTANTS_FILE } from '../../../constants/files.js';
import type { TreePlace } from '../../../tree/types.js';

/**
 * The files allowed directly in a place: its own files that sit at its top ("router.tsx", not "routing/router.tsx",
 * whose folder is a folder of the place), and constants.ts.
 */
export function placeFiles(place: TreePlace): string[] {
  return [...place.files.map((file) => file.path).filter((filePath) => !filePath.includes('/')), CONSTANTS_FILE];
}

/** The folders of a place, for a hint: "components/, hooks/, utils/". */
export function folderList(place: TreePlace): string {
  return place.folders.map((folder) => `${folder.name}/`).join(', ');
}
