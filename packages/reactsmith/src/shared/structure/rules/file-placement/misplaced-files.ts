import path from 'node:path';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';

/** What may sit directly in a folder, and what to say about a file that may not. */
export interface FilePolicy {
  /** The folder, relative to the project root. */
  folderRel: string;
  /** What the folder holds, for the message: "only view folders". */
  holds: string;
  /** Whether a file of this name may sit directly in the folder. */
  allows: (fileName: string) => boolean;
  /** Where to move a file that may not. */
  hint: (fileName: string) => string;
}

/** The name a file gives its folder when moved into one: "Button" for "Button.module.css". */
export function baseName(fileName: string): string {
  return fileName.split('.')[0]!;
}

/** Reports the files directly in the policy's folder that it does not allow. Dotfiles (.gitkeep, .DS_Store) are left alone. */
export async function misplacedFiles(root: string, policy: FilePolicy): Promise<Issue[]> {
  const entries = (await readDir(path.join(root, policy.folderRel))) ?? [];
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && !policy.allows(entry.name))
    .map((entry) => ({
      severity: 'error',
      code: 'file-misplaced',
      path: `${policy.folderRel}/${entry.name}`,
      message: `"${entry.name}" is directly in ${policy.folderRel}/, which holds ${policy.holds}.`,
      hint: policy.hint(entry.name),
    }));
}
