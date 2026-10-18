import { parse } from 'jsonc-parser';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE } from '../config/defaults.js';
import type { StyleLibrary } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';

/**
 * The style library to save in the config: "tailwind" when the project depends on Tailwind.
 * Undefined when the config already sets it, or for CSS Modules, the default.
 */
export async function planStylesDetection(changes: ChangeSet): Promise<StyleLibrary | undefined> {
  const text = await changes.read(CONFIG_FILE);
  const raw: unknown = text === undefined ? undefined : parse(text);
  if (typeof raw === 'object' && raw !== null && 'styles' in raw) return undefined;
  return (await dependencyMajor(changes.root, 'tailwindcss')) === undefined ? undefined : 'tailwind';
}
