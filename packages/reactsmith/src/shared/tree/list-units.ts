import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';
import { readDir } from '../files.js';
import type { TreeFolder, TreeUnit, UnitKind, UnitOwner } from './types.js';

/** The kind of unit a folder holds, by its `holds`. */
const UNIT_KINDS: Partial<Record<TreeFolder['holds'], UnitKind>> = { components: 'component', views: 'view', layouts: 'layout' };

/** The folders directly in `dirRel`, sorted by name. */
async function subfolders(root: string, dirRel: string): Promise<string[]> {
  return ((await readDir(path.join(root, dirRel))) ?? []).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** The units in one folder of units: each folder directly in it. */
async function unitsIn(root: string, kind: UnitKind, owner: UnitOwner, dirRel: string): Promise<TreeUnit[]> {
  return (await subfolders(root, dirRel)).map((name) => ({ kind, name, folderRel: `${dirRel}/${name}`, owner }));
}

/** The units of a place (the app or a feature): the folders in each of its folders of units, in tree order. */
async function placeUnits(root: string, placeRel: string, folders: TreeFolder[], owner: UnitOwner): Promise<TreeUnit[]> {
  const units: TreeUnit[] = [];
  for (const folder of folders) {
    const kind = UNIT_KINDS[folder.holds];
    if (kind) units.push(...(await unitsIn(root, kind, owner, `${placeRel}/${folder.name}`)));
  }
  return units;
}

/**
 * Every unit folder of the project: the shared components (in the folder of each known type), then the app's
 * components, layouts and views, then each feature's. A unit is any folder in a folder of units, whatever its name
 * or content: the unit rules check those. Folders that are not a known type of shared components are left out.
 */
export async function listUnits(root: string, config: ResolvedConfig): Promise<TreeUnit[]> {
  const { tree } = config;
  const units: TreeUnit[] = [];

  const shared = tree.src.folders.find((folder) => folder.holds === 'components');
  if (shared) {
    const types = Object.values(config.componentTypes).flat();
    for (const type of await subfolders(root, `${tree.srcDir}/${shared.name}`)) {
      if (types.includes(type)) units.push(...(await unitsIn(root, 'component', { type }, `${tree.srcDir}/${shared.name}/${type}`)));
    }
  }
  if (tree.app) units.push(...(await placeUnits(root, tree.app.path, tree.app.folders, { app: true })));
  for (const feature of await subfolders(root, tree.features.path)) {
    units.push(...(await placeUnits(root, `${tree.features.path}/${feature}`, tree.features.feature.folders, { feature })));
  }
  return units;
}
