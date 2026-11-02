import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet } from '../changes.js';
import { planComponentCreate, rootLayoutElement } from '../components/create.js';
import { projectComponents } from '../components/registry.js';
import { componentScope, type ComponentOwner } from '../components/scope.js';
import { CONFIG_FILE, HTML_SOURCE, STYLE_FILE_SUFFIXES, TOOL_NAME } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { relativeImport } from '../imports/specifiers.js';
import type { Padding } from '../styles/layout.js';
import { IssueError, type Issue } from '../issues.js';
import { toPascalCase } from '../naming.js';
import { appRouterPath } from '../routes/app-router.js';
import { mountRootLayout, wrapRoutesInLayout } from '../routes/layout.js';
import { addRouteEntry, findExportedRoutesName, listRoutes } from '../routes/add.js';
import { planViewCreate } from '../views/create.js';

/** The app's root layout: the shell around every page. */
export const ROOT_LAYOUT = 'RootLayout';

export interface LayoutCreateOptions {
  /** The layout's name: RootLayout when left out in the app, `<Feature>Layout` in a feature. */
  name?: string;
  /** The feature it belongs to: it then wraps that feature's routes. */
  feature?: string;
  topbar?: boolean;
  sidebar?: boolean;
}

export interface LayoutCreateResult {
  name: string;
  /** Its folder, relative to the root. */
  folder: string;
  /** Where it renders: every page, a feature's pages, or nowhere yet (an app layout that features mount into). */
  mounted: 'root' | 'feature' | 'none';
  warnings: Issue[];
}

function layoutError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The parts placed in the layout, as components of its owner: their name, semantic root element and layout. */
const PARTS = {
  topbar: {
    name: 'TopBar',
    rootTag: 'header',
    layout: { direction: 'row', gap: 2, align: 'center', justify: 'between', padding: [0, 4] },
    extraStyles: {
      css: ['flex-shrink: 0', 'min-height: 3.5rem', 'border-bottom: 1px solid var(--color-border)'],
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
 * The shape of a layout. The root layout is exactly the screen's height and its `main` scrolls on its own, so the
 * top bar and the sidebar stay in place. A nested layout renders inside a page area: it fills it, and its content
 * element takes the remaining space.
 */
interface Shape {
  name: string;
  nested: boolean;
}

/** The style file: the root stacks the top bar above the body, the body puts the sidebar next to the content. */
function layoutStyles(config: ResolvedConfig, shape: Shape, options: LayoutCreateOptions): { content: string; importStatement: string } {
  const both = options.topbar && options.sidebar;
  const rootRow = options.sidebar && !options.topbar;
  const content = shape.nested ? 'content' : 'main';
  const fileName = `${shape.name}${STYLE_FILE_SUFFIXES[config.styles]}`;
  if (config.styles === 'tailwind') {
    const classes = {
      root: `flex ${rootRow ? 'flex-row' : 'flex-col'} ${shape.nested ? 'h-full' : 'h-screen'}`,
      ...(both ? { body: 'flex flex-1 min-h-0' } : {}),
      [content]: shape.nested ? 'flex-1 min-w-0 min-h-0 overflow-auto' : 'flex-1 min-w-0 overflow-auto p-6',
    };
    const lines = Object.entries(classes).map(([key, value]) => `  ${key}: '${value}',\n`);
    return { content: `export const styles = {\n${lines.join('')}};\n`, importStatement: `import { styles } from './${fileName.replace(/\.ts$/, '')}';` };
  }
  const rules = [
    `.root {\n  display: flex;\n  flex-direction: ${rootRow ? 'row' : 'column'};\n  height: ${shape.nested ? '100%' : '100vh'};\n}\n`,
    ...(both ? ['.body {\n  display: flex;\n  flex: 1;\n  min-height: 0;\n}\n'] : []),
    shape.nested ? '.content {\n  flex: 1;\n  min-width: 0;\n  min-height: 0;\n  overflow: auto;\n}\n' : '.main {\n  flex: 1;\n  min-width: 0;\n  overflow: auto;\n  padding: var(--space-6);\n}\n',
  ];
  return { content: rules.join('\n'), importStatement: `import styles from './${fileName}';` };
}

function layoutComponent(config: ResolvedConfig, shape: Shape, options: LayoutCreateOptions, partImports: string[], styleImport: string): string {
  const root = rootLayoutElement(config);
  // The page area is the app's <main>; a nested layout is already inside it.
  const main = !shape.nested && (config.layoutComponents[HTML_SOURCE] ?? []).includes('main') ? 'main' : root.tag;
  const mainLines = [`<${main} className={styles.${shape.nested ? 'content' : 'main'}}>`, '  <Outlet />', `</${main}>`];
  const sidebarAndMain = [...(options.sidebar ? ['<Sidebar />'] : []), ...mainLines];
  const content =
    options.topbar && options.sidebar
      ? ['<TopBar />', `<${root.tag} className={styles.body}>`, ...sidebarAndMain.map((line) => `  ${line}`), `</${root.tag}>`]
      : [...(options.topbar ? ['<TopBar />'] : []), ...sidebarAndMain];

  const imports = ["import { Outlet } from 'react-router';", ...(root.import ? [root.import] : []), ...partImports, styleImport];
  return [
    ...imports,
    '',
    `export const ${shape.name}: React.FC = () => {`,
    '  return (',
    `    <${root.tag} className={styles.root}>`,
    ...content.map((line) => `      ${line}`),
    `    </${root.tag}>`,
    '  );',
    '};',
    '',
  ].join('\n');
}

/** Where a layout goes: its folder, and who its parts belong to. */
function layoutPlace(config: ResolvedConfig, options: LayoutCreateOptions): { name: string; dirRel: string; owner: ComponentOwner; nested: boolean } {
  if (options.feature !== undefined) {
    const layouts = config.featureFolders.layouts;
    if (!layouts) throw layoutError('layouts-disabled', 'Cannot create a feature layout: "featureFolders.layouts" is null.', `Set "featureFolders.layouts" in ${CONFIG_FILE}.`, CONFIG_FILE);
    const name = options.name ?? `${toPascalCase(options.feature)}Layout`;
    return { name, dirRel: `${config.srcDir}/${config.folders.features}/${options.feature}/${layouts}/${name}`, owner: { feature: options.feature }, nested: true };
  }
  const layouts = config.appFolders.layouts;
  if (!layouts) throw layoutError('layouts-disabled', 'Cannot create a layout: layouts are disabled ("appFolders.layouts" is null).', `Set "appFolders.layouts" in ${CONFIG_FILE}.`, CONFIG_FILE);
  const name = options.name ?? ROOT_LAYOUT;
  return { name, dirRel: `${config.srcDir}/${config.folders.app}/${layouts}/${name}`, owner: { app: true }, nested: name !== ROOT_LAYOUT };
}

/**
 * Plans a layout (with a top bar and a sidebar, as components of its owner, when asked):
 * - the app's root layout, `<app>/layouts/RootLayout/`, set as the Component of the "/" route so every page renders
 *   inside it;
 * - with a name, a nested app layout, which features are mounted into ("feature create --layout");
 * - with a feature, the feature's layout, `<feature>/layouts/<Name>/`, wrapping the feature's routes.
 */
export async function planLayoutCreate(changes: ChangeSet, config: ResolvedConfig, options: LayoutCreateOptions): Promise<LayoutCreateResult> {
  const routerRel = appRouterPath(config);
  if (!config.router || !routerRel) {
    throw layoutError('router-not-configured', 'Cannot create a layout: no router is configured.', `Install React Router and run "${TOOL_NAME} init", then try again.`, CONFIG_FILE);
  }
  const place = layoutPlace(config, options);
  const { name, dirRel, owner } = place;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw layoutError('layout-name-invalid', `"${name}" is not a valid layout name.`, 'Use a PascalCase name like "DocsLayout".');
  if (await stat(changes.resolve(dirRel)).catch(() => undefined)) {
    throw layoutError('layout-exists', `The layout "${name}" already exists in ${dirRel}.`, 'Edit it, or insert elements and components into it with "element insert".', dirRel);
  }
  const taken = (await projectComponents(changes.root, config)).find((component) => component.name === name);
  if (taken) throw layoutError('component-name-taken', `"${name}" already exists in ${taken.folderRel}.`, 'Component and layout names are unique in the project: choose another name.', taken.folderRel);

  // Where it renders: the "/" route, the feature's routes, or nowhere yet.
  let routesUpdate: { fileRel: string; text: string; message: string } | undefined;
  let mounted: LayoutCreateResult['mounted'] = 'none';
  if ('feature' in owner) {
    const featureRel = `${config.srcDir}/${config.folders.features}/${owner.feature}`;
    if (!(await stat(changes.resolve(featureRel)).catch(() => undefined))) {
      throw layoutError('feature-missing', `Feature "${owner.feature}" does not exist.`, `Create it first with "feature create ${owner.feature}".`, featureRel);
    }
    const routesRel = config.featureRoutes ? `${featureRel}/${config.featureRoutes}` : undefined;
    const routesText = routesRel ? await changes.read(routesRel) : undefined;
    const routesName = routesText === undefined ? undefined : findExportedRoutesName(routesText, path.posix.basename(routesRel!));
    if (!routesRel || routesText === undefined || !routesName) {
      throw layoutError('feature-routes-missing', `Feature "${owner.feature}" has no routes to wrap in a layout.`, `Its routes file (${config.featureRoutes ?? 'routes.tsx'}) exports the routes array, e.g. after "view create <name> --feature ${owner.feature}".`, featureRel);
    }
    const wrapped = wrapRoutesInLayout(routesText, path.posix.basename(routesRel), routesName, name, `import { ${name} } from '${relativeImport(routesRel, `${dirRel}/index.ts`)}'`);
    if (wrapped.status === 'exists') {
      throw layoutError('feature-has-layout', `The routes of feature "${owner.feature}" already render inside a layout.`, 'A feature has one layout: edit it, or nest the pages that need more in a layout of their own by hand.', routesRel);
    }
    if (wrapped.status === 'manual') throw layoutError('feature-routes-unsupported', `Cannot wrap the routes in ${routesRel}: ${wrapped.reason}.`, `Wrap them by hand: [{ Component: ${name}, children: [...] }].`, routesRel);
    routesUpdate = { fileRel: routesRel, text: wrapped.text, message: `rendered the pages of "${owner.feature}" inside ${name}` };
    mounted = 'feature';

    // The feature's own not-found page: unknown URLs under it keep the layout, instead of falling to the app's.
    const pages = listRoutes(wrapped.text, path.posix.basename(routesRel), routesName) ?? [];
    const viewsFolder = config.featureFolders.views;
    if (viewsFolder && !pages.some((page) => page.path === '*')) {
      const viewsRel = `${featureRel}/${viewsFolder}`;
      const viewName = `NotFound${config.viewSuffix}`;
      if (await stat(changes.resolve(`${viewsRel}/${viewName}`)).catch(() => undefined)) {
        changes.skip(`${viewsRel}/${viewName}`, `${viewName} exists: route it with "view create NotFound --feature ${owner.feature} --path '*'" to keep the layout on unknown pages`);
      } else {
        await planViewCreate(changes, config, viewsRel, viewName, { title: 'Page not found' });
        const added = addRouteEntry(wrapped.text, path.posix.basename(routesRel), routesName, `{ path: '*', lazy: () => import('${relativeImport(routesRel, `${viewsRel}/${viewName}/index.ts`)}') }`);
        if (added.status === 'added') routesUpdate = { ...routesUpdate, text: added.text, message: `${routesUpdate.message}, with ${viewName} for unknown pages` };
      }
    }
  } else if (name === ROOT_LAYOUT) {
    const routerText = await changes.read(routerRel);
    if (routerText === undefined) throw layoutError('app-router-missing', `${routerRel} does not exist.`, `Run "${TOOL_NAME} init" to create it.`, routerRel);
    const root = mountRootLayout(routerText, path.posix.basename(routerRel), 'routes', ROOT_LAYOUT, `import { ${ROOT_LAYOUT} } from '${relativeImport(routerRel, `${dirRel}/index.ts`)}'`);
    if (root.status === 'exists') {
      throw layoutError('layout-route-taken', `The "/" route in ${routerRel} already renders a component.`, 'Remove its Component, element or lazy to use the root layout, or edit that component.', routerRel);
    }
    if (root.status === 'manual') throw layoutError('app-router-unsupported', `Cannot add the layout to ${routerRel}: ${root.reason}.`, 'Add a route { path: \'/\', children: [...] } holding the pages.', routerRel);
    routesUpdate = { fileRel: routerRel, text: root.text, message: `rendered every page inside ${ROOT_LAYOUT}` };
    mounted = 'root';
  }

  // The parts are components of the layout's owner: created when missing, reused when they exist. One that exists
  // elsewhere is not the owner's: it moves first.
  const warnings: Issue[] = [];
  const partImports: string[] = [];
  const scope = componentScope(config, owner);
  const all = await projectComponents(changes.root, config);
  for (const key of ['topbar', 'sidebar'] as const) {
    if (!options[key]) continue;
    const part = PARTS[key];
    const partRel = `${scope.componentsRel}/${part.name}`;
    const elsewhere = all.find((component) => component.name === part.name && component.folderRel !== partRel);
    if (elsewhere) {
      const move = 'feature' in owner ? `--feature ${owner.feature}` : '--app';
      throw layoutError('layout-part-elsewhere', `${part.name} exists in ${elsewhere.folderRel}, not in ${scope.label}.`, `Move it first: "component update ${part.name} ${move}", or leave out --${key} and insert what the layout needs with "element insert".`, elsewhere.folderRel);
    }
    if (await stat(changes.resolve(partRel)).catch(() => undefined)) {
      changes.skip(partRel, `${part.name} already exists, it is reused`);
    } else {
      warnings.push(...(await planComponentCreate(changes, config, { owner, name: part.name, rootTag: part.rootTag, layout: { ...part.layout, padding: [...part.layout.padding] as Padding }, extraStyles: { css: [...part.extraStyles.css], tailwind: [...part.extraStyles.tailwind] } })));
    }
    partImports.push(`import { ${part.name} } from '${relativeImport(`${dirRel}/${name}.tsx`, `${partRel}/index.ts`)}';`);
  }

  const shape = { name, nested: place.nested };
  const styles = layoutStyles(config, shape, options);
  changes.write(`${dirRel}/${name}.tsx`, layoutComponent(config, shape, options, partImports, styles.importStatement), { type: 'create', message: name === ROOT_LAYOUT ? 'root layout' : 'layout' });
  changes.write(`${dirRel}/${name}${STYLE_FILE_SUFFIXES[config.styles]}`, styles.content, { type: 'create', message: 'styles' });
  changes.write(`${dirRel}/index.ts`, `export { ${name} } from './${name}';\n`, { type: 'create', message: 'layout entry point' });
  if (routesUpdate) changes.write(routesUpdate.fileRel, routesUpdate.text, { type: 'update', message: routesUpdate.message });
  return { name, folder: dirRel, mounted, warnings };
}
