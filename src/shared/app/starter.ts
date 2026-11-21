import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import type { AppFilesLocation, ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import { appRouterPath } from '../routes/app-router.js';

const ROUTER_TODO = 'render <RouterProvider router={router} /> (from "react-router/dom") in your App component';
const ASSET = /from\s+['"](\.{1,2}\/[^'"]+\.(?:png|svg|jpe?g|gif|webp|avif))['"]/g;

/** The Vite React starter: its demo page imports the React logo and counts clicks. Nothing of it is worth keeping. */
function isViteStarter(text: string): boolean {
  return /react\.svg['"]/.test(text) && /useState\(0\)/.test(text);
}

function appComponent(routerImport: string, stylesImport: string | undefined): string {
  return [
    "import { RouterProvider } from 'react-router/dom';",
    `import { router } from '${routerImport}';`,
    ...(stylesImport ? [`import '${stylesImport}';`] : []),
    '',
    'function App() {',
    '  return <RouterProvider router={router} />;',
    '}',
    '',
    'export default App;',
    '',
  ].join('\n');
}

/** "./styles/global.css": an import of a file that keeps its extension, unlike relativeImport. */
function relativeFileImport(fromFile: string, toFile: string): string {
  const relative = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** Plans deleting what only the starter page used: App.css, its images, and index.css with its import in main. */
async function planStarterCleanup(changes: ChangeSet, config: ResolvedConfig, appRel: string, starterText: string): Promise<void> {
  const appDir = path.posix.dirname(appRel);
  if ((await changes.read(`${appDir}/App.css`)) !== undefined) changes.delete(`${appDir}/App.css`, 'styles of the Vite starter page');

  for (const [, specifier] of starterText.matchAll(ASSET)) {
    const assetRel = path.posix.normalize(path.posix.join(appDir, specifier!));
    if ((await changes.read(assetRel)) === undefined) continue;
    changes.delete(assetRel, 'image of the Vite starter page');
    changes.removeIfEmpty(changes.resolve(path.posix.dirname(assetRel)));
  }

  const indexCss = `${config.srcDir}/index.css`;
  for (const main of ['main.tsx', 'main.jsx']) {
    const mainRel = `${config.srcDir}/${main}`;
    const text = await changes.read(mainRel);
    const importLine = /^import\s+['"]\.\/index\.css['"];?[ \t]*\r?\n/m;
    if (text === undefined || !importLine.test(text)) continue;
    changes.write(mainRel, text.replace(importLine, ''), { type: 'update', message: 'removed the import of index.css' });
    if ((await changes.read(indexCss)) !== undefined) changes.delete(indexCss, 'global styles of the Vite starter, replaced by the app global styles');
    return;
  }
}

/**
 * Plans the App component, where the App files will be (`appFiles`). The Vite starter page is replaced by one
 * that renders the app router and imports the global styles, and the starter's styles and images are deleted.
 * Another App component is left to the dev, with a todo for each missing piece.
 */
export async function planAppComponent(changes: ChangeSet, config: ResolvedConfig, appFiles: AppFilesLocation, globalStylesRel?: string): Promise<void> {
  const routerRel = appRouterPath(config);
  const hasRouter = routerRel !== undefined && (await changes.read(routerRel)) !== undefined;
  const dir = appFiles === 'app' && config.folders.app ? `${config.srcDir}/${config.folders.app}` : config.srcDir;

  for (const name of ['App.tsx', 'App.jsx']) {
    const appRel = `${dir}/${name}`;
    const text = await changes.read(appRel);
    if (text === undefined) continue;
    const stylesImport = globalStylesRel && relativeFileImport(appRel, globalStylesRel);

    if (hasRouter && isViteStarter(text)) {
      changes.write(appRel, appComponent(relativeImport(appRel, routerRel!), stylesImport), {
        type: 'update',
        message: `render the router${stylesImport ? ' with the global styles' : ''} (replaces the Vite starter page)`,
      });
      await planStarterCleanup(changes, config, appRel, text);
      return;
    }
    if (hasRouter && !text.includes('RouterProvider')) changes.todo(appRel, ROUTER_TODO);
    if (stylesImport && !text.includes(path.posix.basename(globalStylesRel!))) changes.todo(appRel, `import the global styles: import '${stylesImport}';`);
    return;
  }
  if (hasRouter) changes.todo(routerRel!, ROUTER_TODO);
}
