import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { planComponentCreate, rootLayoutElement } from '../components/create.js';
import { componentScope } from '../components/scope.js';
import { CONFIG_FILE, HTML_SOURCE, STYLE_FILE_SUFFIXES, TOOL_NAME } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import type { Padding } from '../styles/layout.js';
import { IssueError, type Issue } from '../issues.js';
import { appRouterPath } from '../routes/app-router.js';
import { mountRootLayout } from '../routes/layout.js';

/** The app's root layout: the shell around every page. */
export const ROOT_LAYOUT = 'RootLayout';

export interface LayoutCreateOptions {
  topbar?: boolean;
  sidebar?: boolean;
}

function layoutError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The parts placed in the layout, as app components: their name, semantic root element and layout. */
const PARTS = {
  topbar: {
    name: 'TopBar',
    rootTag: 'header',
    layout: { direction: 'row', gap: 2, align: 'center', justify: 'between', padding: [0, 4] },
    extraStyles: {
      css: ['flex-shrink: 0', 'height: 3.5rem', 'border-bottom: 1px solid var(--color-border)'],
      tailwind: ['shrink-0', 'h-14', 'border-b', 'border-border'],
    },
  },
  sidebar: {
    name: 'Sidebar',
    rootTag: 'aside',
    layout: { direction: 'column', gap: 2, padding: [4] },
    extraStyles: {
      css: ['flex-shrink: 0', 'width: 15rem', 'overflow: auto', 'border-right: 1px solid var(--color-border)'],
      tailwind: ['shrink-0', 'w-60', 'overflow-auto', 'border-r', 'border-border'],
    },
  },
} as const;

/**
 * The layout's style file: the root is exactly the screen's height and stacks the top bar above the body,
 * the body puts the sidebar next to the main content, which takes the remaining space and scrolls on its own,
 * so the top bar and the sidebar stay in place.
 */
function layoutStyles(config: ResolvedConfig, options: LayoutCreateOptions): { content: string; importStatement: string } {
  const both = options.topbar && options.sidebar;
  const rootRow = options.sidebar && !options.topbar;
  const fileName = `${ROOT_LAYOUT}${STYLE_FILE_SUFFIXES[config.styles]}`;
  if (config.styles === 'tailwind') {
    const classes = {
      root: `flex ${rootRow ? 'flex-row' : 'flex-col'} h-screen`,
      ...(both ? { body: 'flex flex-1 min-h-0' } : {}),
      main: 'flex-1 min-w-0 overflow-auto p-6',
    };
    const lines = Object.entries(classes).map(([key, value]) => `  ${key}: '${value}',\n`);
    return { content: `export const styles = {\n${lines.join('')}};\n`, importStatement: `import { styles } from './${fileName.replace(/\.ts$/, '')}';` };
  }
  const rules = [
    `.root {\n  display: flex;\n  flex-direction: ${rootRow ? 'row' : 'column'};\n  height: 100vh;\n}\n`,
    ...(both ? ['.body {\n  display: flex;\n  flex: 1;\n  min-height: 0;\n}\n'] : []),
    '.main {\n  flex: 1;\n  min-width: 0;\n  overflow: auto;\n  padding: var(--space-6);\n}\n',
  ];
  return { content: rules.join('\n'), importStatement: `import styles from './${fileName}';` };
}

function layoutComponent(config: ResolvedConfig, options: LayoutCreateOptions, partImports: string[], styleImport: string): string {
  const root = rootLayoutElement(config);
  const main = (config.layoutComponents[HTML_SOURCE] ?? []).includes('main') ? 'main' : root.tag;
  const mainLines = [`<${main} className={styles.main}>`, '  <Outlet />', `</${main}>`];
  const sidebarAndMain = [...(options.sidebar ? ['<Sidebar />'] : []), ...mainLines];
  const content =
    options.topbar && options.sidebar
      ? ['<TopBar />', `<${root.tag} className={styles.body}>`, ...sidebarAndMain.map((line) => `  ${line}`), `</${root.tag}>`]
      : [...(options.topbar ? ['<TopBar />'] : []), ...sidebarAndMain];

  const imports = ["import { Outlet } from 'react-router';", ...(root.import ? [root.import] : []), ...partImports, styleImport];
  return [
    ...imports,
    '',
    `export const ${ROOT_LAYOUT}: React.FC = () => {`,
    '  return (',
    `    <${root.tag} className={styles.root}>`,
    ...content.map((line) => `      ${line}`),
    `    </${root.tag}>`,
    '  );',
    '};',
    '',
  ].join('\n');
}

/**
 * Plans the app's root layout: `<app>/layouts/RootLayout/` (with a top bar and a sidebar, as app components,
 * when asked), set as the Component of the "/" route so every page renders inside it. Returns warnings.
 */
export async function planLayoutCreate(changes: ChangeSet, config: ResolvedConfig, options: LayoutCreateOptions): Promise<Issue[]> {
  const routerRel = appRouterPath(config);
  if (!config.router || !routerRel) {
    throw layoutError('router-not-configured', 'Cannot create a layout: no router is configured.', `Install React Router and run "${TOOL_NAME} init", then try again.`, CONFIG_FILE);
  }
  const layoutsFolder = config.appFolders.layouts;
  if (!layoutsFolder) {
    throw layoutError('layouts-disabled', 'Cannot create a layout: layouts are disabled ("appFolders.layouts" is null).', `Set "appFolders.layouts" in ${CONFIG_FILE}.`, CONFIG_FILE);
  }
  const routerText = await changes.read(routerRel);
  if (routerText === undefined) {
    throw layoutError('app-router-missing', `${routerRel} does not exist.`, `Run "${TOOL_NAME} init" to create it.`, routerRel);
  }
  const dirRel = `${config.srcDir}/${config.folders.app}/${layoutsFolder}/${ROOT_LAYOUT}`;
  if (await stat(changes.resolve(dirRel)).catch(() => undefined)) {
    throw layoutError('layout-exists', `The root layout already exists in ${dirRel}.`, 'Edit it, or insert elements and components into it with "element insert".', dirRel);
  }

  const mounted = mountRootLayout(routerText, path.posix.basename(routerRel), 'routes', ROOT_LAYOUT, `import { ${ROOT_LAYOUT} } from '${relativeImport(routerRel, `${dirRel}/index.ts`)}'`);
  if (mounted.status === 'exists') {
    throw layoutError('layout-route-taken', `The "/" route in ${routerRel} already renders a component.`, 'Remove its Component, element or lazy to use the root layout, or edit that component.', routerRel);
  }
  if (mounted.status === 'manual') {
    throw layoutError('app-router-unsupported', `Cannot add the layout to ${routerRel}: ${mounted.reason}.`, 'Add a route { path: \'/\', children: [...] } holding the pages.', routerRel);
  }

  // The parts are app components: created when missing, reused when they exist.
  const warnings: Issue[] = [];
  const partImports: string[] = [];
  const { componentsRel } = componentScope(config, { app: true });
  for (const key of ['topbar', 'sidebar'] as const) {
    if (!options[key]) continue;
    const part = PARTS[key];
    const partRel = `${componentsRel}/${part.name}`;
    if (await stat(changes.resolve(partRel)).catch(() => undefined)) {
      changes.skip(partRel, `${part.name} already exists, it is reused`);
    } else {
      warnings.push(...(await planComponentCreate(changes, config, { owner: { app: true }, name: part.name, rootTag: part.rootTag, layout: { ...part.layout, padding: [...part.layout.padding] as Padding }, extraStyles: { css: [...part.extraStyles.css], tailwind: [...part.extraStyles.tailwind] } })));
    }
    partImports.push(`import { ${part.name} } from '${relativeImport(`${dirRel}/${ROOT_LAYOUT}.tsx`, `${partRel}/index.ts`)}';`);
  }

  const styles = layoutStyles(config, options);
  changes.write(`${dirRel}/${ROOT_LAYOUT}.tsx`, layoutComponent(config, options, partImports, styles.importStatement), { type: 'create', message: 'root layout' });
  changes.write(`${dirRel}/${ROOT_LAYOUT}${STYLE_FILE_SUFFIXES[config.styles]}`, styles.content, { type: 'create', message: 'styles' });
  changes.write(`${dirRel}/index.ts`, `export { ${ROOT_LAYOUT} } from './${ROOT_LAYOUT}';\n`, { type: 'create', message: 'layout entry point' });
  changes.write(routerRel, mounted.text, { type: 'update', message: `rendered every page inside ${ROOT_LAYOUT}` });
  return warnings;
}
