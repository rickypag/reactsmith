import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkConstantsFiles } from '../../../constants/files.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';

/**
 * Constants: every constants.ts (of a component, a feature or the app) only exports constants holding plain data.
 * Not this rule's: where a constants.ts may be (file-placement, components).
 */
export async function checkConstants(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return checkConstantsFiles(root, config, (fileRel) => readFile(path.join(root, fileRel), 'utf8').catch(() => undefined));
}
