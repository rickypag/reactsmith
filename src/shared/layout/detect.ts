import { parse } from 'jsonc-parser';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE, LAYOUT_LIBRARIES, LAYOUT_PRESETS } from '../config/defaults.js';
import { dependencyMajor } from '../dependencies.js';

/** The first UI library with a layout preset that the project depends on. */
export async function detectLayoutLibrary(root: string): Promise<(typeof LAYOUT_LIBRARIES)[number] | undefined> {
  for (const library of LAYOUT_LIBRARIES) {
    if ((await dependencyMajor(root, library)) !== undefined) return library;
  }
  return undefined;
}

/**
 * The layout components to save in the config: the preset of the UI library the project uses.
 * Undefined when the config already sets them, or when no supported library is installed (the HTML default applies).
 */
export async function planLayoutDetection(changes: ChangeSet): Promise<Record<string, string[]> | undefined> {
  const text = await changes.read(CONFIG_FILE);
  const raw: unknown = text === undefined ? undefined : parse(text);
  if (typeof raw === 'object' && raw !== null && 'layoutComponents' in raw) return undefined;

  const library = await detectLayoutLibrary(changes.root);
  if (!library) return undefined;
  return Object.fromEntries(Object.entries(LAYOUT_PRESETS[library]).map(([source, names]) => [source, [...names]]));
}
