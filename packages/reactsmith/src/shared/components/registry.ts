import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';

/** A component the project can import by name: a component (feature, app or shared) or a layout. */
export interface ProjectComponent {
  name: string;
  /** Its folder, relative to the project root. */
  folderRel: string;
}

async function subfolders(root: string, dirRel: string): Promise<string[]> {
  const entries = await readdir(path.join(root, dirRel), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The component folders directly in `dirRel`: the folders holding a file named like them. */
async function componentFolders(root: string, dirRel: string): Promise<ProjectComponent[]> {
  const found: ProjectComponent[] = [];
  for (const name of await subfolders(root, dirRel)) {
    const files = await readdir(path.join(root, dirRel, name)).catch(() => [] as string[]);
    if (files.some((file) => file === `${name}.tsx` || file === `${name}.jsx`)) found.push({ name, folderRel: `${dirRel}/${name}` });
  }
  return found;
}

/**
 * Every component the project can import by name: the components of each feature, of the app and of each type of
 * shared components, and the layouts (the app's and each feature's). Views are not in it: routes load them by folder,
 * and their names repeat across features.
 */
export async function projectComponents(root: string, config: ResolvedConfig): Promise<ProjectComponent[]> {
  const { srcDir, folders, featureFolders, appFolders } = config;
  const dirs: string[] = [];
  for (const feature of await subfolders(root, `${srcDir}/${folders.features}`)) {
    if (featureFolders.components) dirs.push(`${srcDir}/${folders.features}/${feature}/${featureFolders.components}`);
    if (featureFolders.layouts) dirs.push(`${srcDir}/${folders.features}/${feature}/${featureFolders.layouts}`);
  }
  if (folders.app && appFolders.components) dirs.push(`${srcDir}/${folders.app}/${appFolders.components}`);
  if (folders.app && appFolders.layouts) dirs.push(`${srcDir}/${folders.app}/${appFolders.layouts}`);
  if (folders.components) {
    for (const type of await subfolders(root, `${srcDir}/${folders.components}`)) dirs.push(`${srcDir}/${folders.components}/${type}`);
  }
  return (await Promise.all(dirs.map((dir) => componentFolders(root, dir)))).flat();
}
