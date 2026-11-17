import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { NEXT_APP_FOLDER } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';

/** Next's root layouts: the files that render <html> and import the app's global CSS. */
const ROOT_LAYOUTS = ['layout.tsx', 'layout.jsx'];

function relativeFileImport(fromFile: string, toFile: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * In a Next.js app the root layout (src/app/layout.tsx) takes the place of the App component: init leaves it to
 * the dev, with a todo to import the global styles when it doesn't yet.
 */
export async function planNextRootLayout(changes: ChangeSet, config: ResolvedConfig, globalStylesRel?: string): Promise<void> {
  if (!globalStylesRel) return;
  for (const name of ROOT_LAYOUTS) {
    const layoutRel = `${config.srcDir}/${NEXT_APP_FOLDER}/${name}`;
    const text = await changes.read(layoutRel);
    if (text === undefined) continue;
    if (text.includes(path.posix.basename(globalStylesRel))) return;
    const stylesImport = relativeFileImport(layoutRel, globalStylesRel);
    const starter = /import\s+['"](\.\/globals\.css)['"]/.exec(text)?.[1];
    changes.todo(layoutRel, `import the global styles: import '${stylesImport}';${starter ? ` (in place of '${starter}')` : ''}`);
    return;
  }
}
