import type { Dirent } from 'node:fs';
import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue, Severity } from '../../../issues.js';
import type { TreePlace } from '../../../tree/types.js';

/** The places of the tree, by the config key that lists their folders. */
const PLACES = {
  folders: { code: 'unknown-folder', where: (placeRel: string) => `${placeRel}/` },
  appFolders: { code: 'unknown-app-folder', where: (placeRel: string) => `${placeRel}/` },
  featureFolders: { code: 'unknown-feature-folder', where: (_: string, feature?: string) => `feature "${feature}"` },
} as const;

export type PlaceKey = keyof typeof PLACES;

/** The folder names allowed in a place: its folders, and the first folder of a nested file ("routes" for "routes/index.tsx"). */
function allowedNames(place: TreePlace): string[] {
  const fileFolders = place.files.filter((file) => file.path.includes('/')).map((file) => file.path.split('/')[0]!);
  return [...place.folders.map((folder) => folder.name), ...fileFolders];
}

/** Suggests the allowed name when a folder only differs by case, e.g. "Components" vs "components". */
export function caseHint(name: string, allowed: string[]): string | undefined {
  const match = allowed.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return match ? `Folder names are case-sensitive: rename it to "${match}".` : undefined;
}

/** Reports the folders of `entries` that the place does not allow, following the unknownFolders policy. */
export function unknownFolders(config: ResolvedConfig, placeKey: PlaceKey, place: TreePlace, placeRel: string, entries: Dirent[], feature?: string): Issue[] {
  if (config.unknownFolders === 'allow') return [];
  const severity: Severity = config.unknownFolders === 'error' ? 'error' : 'warning';
  const allowed = allowedNames(place);
  const { code, where } = PLACES[placeKey];
  return entries
    .filter((entry) => entry.isDirectory() && !allowed.includes(entry.name))
    .map((entry) => ({
      severity,
      code,
      path: `${placeRel}/${entry.name}`,
      message: `Unknown folder "${entry.name}" in ${where(placeRel, feature)}.`,
      hint:
        caseHint(entry.name, allowed) ??
        `Remove or rename it, or add it to "${placeKey}" in ${CONFIG_FILE}, e.g. "${entry.name}": "${entry.name}".`,
    }));
}
