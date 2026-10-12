import { applyEdits, modify } from 'jsonc-parser';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE } from './defaults.js';
import type { UserConfig } from './types.js';

function describe(values: Partial<UserConfig>): string {
  return Object.entries(values)
    .map(([key, value]) => `"${key}": ${JSON.stringify(value)}`)
    .join(', ');
}

/** Plans creating the config file, or setting keys in it while keeping the rest of the file as is. */
export async function planConfigUpdate(changes: ChangeSet, values: Partial<UserConfig>): Promise<void> {
  const text = await changes.read(CONFIG_FILE);
  if (text === undefined) {
    changes.write(CONFIG_FILE, `${JSON.stringify(values, null, 2)}\n`, { type: 'create', message: `with ${describe(values)}` });
    return;
  }

  let updated = text;
  for (const [key, value] of Object.entries(values)) {
    updated = applyEdits(updated, modify(updated, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  if (updated === text) {
    changes.skip(CONFIG_FILE, `already sets ${describe(values)}`);
    return;
  }
  changes.write(CONFIG_FILE, updated, { type: 'update', message: `set ${describe(values)}` });
}
