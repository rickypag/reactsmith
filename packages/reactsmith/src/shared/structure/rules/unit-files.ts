import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { TreeUnit } from '../../tree/types.js';

/** The UI of a component that loads data: props in, JSX out. */
export const CONTENT_SUFFIX = 'Content';

/** The placeholder a component that loads data shows while loading. */
export const SKELETON_SUFFIX = 'Skeleton';

/** A .tsx file of a unit, with the component it holds. */
export interface UnitFile {
  /** The component the file holds: "UserCard", "UserCardContent". */
  component: string;
  fileRel: string;
  text: string;
}

/** The component names a unit's files may hold: the unit itself and, for a component, its Content and Skeleton. */
export function unitComponents(unit: TreeUnit): string[] {
  return unit.kind === 'component' ? [unit.name, `${unit.name}${CONTENT_SUFFIX}`, `${unit.name}${SKELETON_SUFFIX}`] : [unit.name];
}

/** The .tsx files a unit has, read: Name.tsx and, for a component, NameContent.tsx and NameSkeleton.tsx. */
export async function unitFiles(root: string, unit: TreeUnit): Promise<UnitFile[]> {
  const files: UnitFile[] = [];
  for (const component of unitComponents(unit)) {
    const fileRel = `${unit.folderRel}/${component}.tsx`;
    const text = await readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
    if (text !== undefined) files.push({ component, fileRel, text });
  }
  return files;
}
