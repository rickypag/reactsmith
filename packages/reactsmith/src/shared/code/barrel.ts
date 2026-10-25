import type { ChangeSet } from '../changes.js';

/** The barrel of the folder holding a file: "src/utils/cx.ts" → "src/utils/index.ts". */
export function barrelOf(fileRel: string): string {
  return `${fileRel.slice(0, fileRel.lastIndexOf('/'))}/index.ts`;
}

/** Plans re-exports in a barrel (index.ts), creating the barrel when it is missing. Lines already there are kept once. */
export async function planBarrelExports(changes: ChangeSet, barrelRel: string, lines: string[]): Promise<void> {
  const text = await changes.read(barrelRel);
  const missing = lines.filter((line) => !text?.includes(line));
  if (missing.length === 0) return;
  if (text === undefined) {
    changes.write(barrelRel, `${missing.join('\n')}\n`, { type: 'create', message: 'barrel: what the folder offers' });
  } else {
    changes.write(barrelRel, `${text.replace(/\s*$/, '\n')}${missing.join('\n')}\n`, { type: 'update', message: `added ${missing.length === 1 ? `"${missing[0]}"` : `${missing.length} exports`}` });
  }
}
