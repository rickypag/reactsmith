import { describe, expect, it } from 'vitest';
import { featureCreateCommand } from '../../src/commands/feature/create/command.js';
import { layoutCreateCommand } from '../../src/commands/layout/create/command.js';
import { viewCreateCommand } from '../../src/commands/view/create/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const config = { router: { library: 'react-router', version: 7, mode: 'data' }, appFiles: 'app' };
const lines = (...text: string[]) => `${text.join('\n')}\n`;
const routesRel = 'src/features/docs/routes.tsx';
const layoutRel = 'src/features/docs/layouts/DocsLayout';

/** A view of the docs feature, complete enough for check. */
const view = (name: string) => ({
  [`src/features/docs/views/${name}/${name}.tsx`]: lines(`import styles from './${name}.module.css';`, '', `export const ${name}: React.FC = () => {`, '  return <div className={styles.root} />;', '};'),
  [`src/features/docs/views/${name}/${name}.module.css`]: '.root {\n}\n',
  [`src/features/docs/views/${name}/index.ts`]: `export { ${name} as Component } from './${name}';\n`,
});

const TREE = {
  'src/app/router.tsx': lines(
    "import { createBrowserRouter, type RouteObject } from 'react-router';",
    "import { docsRoutes } from '@/features/docs';",
    '',
    'const routes: RouteObject[] = [',
    "  { path: '/', children: [{ path: 'docs', children: docsRoutes }] },",
    '];',
    '',
    'export const router = createBrowserRouter(routes);',
  ),
  'src/features/docs/index.ts': "export { docsRoutes } from './routes';\n",
  [routesRel]: lines(
    "import type { RouteObject } from 'react-router';",
    '',
    'export const docsRoutes: RouteObject[] = [',
    "  { index: true, lazy: () => import('./views/IntroductionView') },",
    '  {',
    "    path: 'installation',",
    "    lazy: () => import('./views/InstallationView'),",
    '  },',
    '];',
  ),
  ...view('IntroductionView'),
  ...view('InstallationView'),
};

const create = (root: string, name: string | undefined, options: { feature?: string; topbar?: boolean; sidebar?: boolean } = {}) =>
  layoutCreateCommand.run({ cwd: root, args: { name }, options: { feature: options.feature, topbar: options.topbar ?? false, sidebar: options.sidebar ?? false, dryRun: false } });
const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code) ?? [];
const errors = async (root: string) => (await checkStructure(root)).issues.filter((issue) => issue.severity === 'error').map((issue) => `${issue.code} ${issue.path}`);

describe('layout create: a feature layout', () => {
  it('wraps the feature\'s routes, keeping each route as written, and the project stays valid', async () => {
    const root = await createProject(TREE, config);
    const result = await create(root, undefined, { feature: 'docs', sidebar: true });
    expect(codes(result)).toEqual([]);
    expect(result.summary).toBe('Layout "DocsLayout" created: the pages of feature "docs" render inside it.');
    expect(await read(root, routesRel)).toBe(lines(
      "import type { RouteObject } from 'react-router';",
      "import { DocsLayout } from './layouts/DocsLayout';",
      '',
      'export const docsRoutes: RouteObject[] = [',
      '  {',
      '    Component: DocsLayout,',
      '    children: [',
      "      { index: true, lazy: () => import('./views/IntroductionView') },",
      '      {',
      "        path: 'installation',",
      "        lazy: () => import('./views/InstallationView'),",
      '      },',
      "      { path: '*', lazy: () => import('./views/NotFoundView') },",
      '    ],',
      '  },',
      '];',
    ));
    // Its own not-found page: unknown URLs under /docs keep the layout.
    expect(await read(root, 'src/features/docs/views/NotFoundView/NotFoundView.tsx')).toContain('<h1>Page not found</h1>');
    // The sidebar is the feature's; the layout fills the page area instead of the screen.
    expect(await exists(root, 'src/features/docs/components/Sidebar/Sidebar.tsx')).toBe(true);
    expect(await read(root, `${layoutRel}/DocsLayout.tsx`)).toContain("import { Sidebar } from '../../components/Sidebar';");
    expect(await read(root, `${layoutRel}/DocsLayout.tsx`)).toContain('<div className={styles.content}>');
    // It fills the page area exactly, and only its content scrolls: the sidebar stays in place.
    expect(await read(root, `${layoutRel}/DocsLayout.module.css`)).toBe(lines(
      '.root {', '  display: flex;', '  flex-direction: row;', '  height: 100%;', '}', '',
      '.content {', '  flex: 1;', '  min-width: 0;', '  min-height: 0;', '  overflow: auto;', '}',
    ));
    expect(await errors(root)).toEqual([]);
  });

  it('gets the new views of the feature inside it', async () => {
    const root = await createProject(TREE, config);
    await create(root, undefined, { feature: 'docs' });
    const result = await viewCreateCommand.run({ cwd: root, args: { name: 'QuickStart' }, options: { feature: 'docs', path: 'quick-start', index: false, loader: false, dryRun: false } });
    expect(result.issues ?? []).toEqual([]);
    // New views go before the catch-all, which stays last.
    expect(await read(root, routesRel)).toContain(lines(
      "        lazy: () => import('./views/InstallationView'),",
      '      },',
      "      { path: 'quick-start', lazy: () => import('./views/QuickStartView') },",
      "      { path: '*', lazy: () => import('./views/NotFoundView') },",
      '    ],',
    ));
    expect(await errors(root)).toEqual([]);
    // A second index route is still refused, inside the layout too.
    expect(codes(await viewCreateCommand.run({ cwd: root, args: { name: 'Home' }, options: { feature: 'docs', path: undefined, index: true, loader: false, dryRun: false } }))).toEqual(['index-route-exists']);
  });

  it('refuses a second layout, a missing feature, and a part that belongs to another owner', async () => {
    const root = await createProject(TREE, config);
    expect(codes(await create(root, undefined, { feature: 'docs' }))).toEqual([]);
    expect(codes(await create(root, 'GuideLayout', { feature: 'docs' }))).toEqual(['feature-has-layout']);
    expect(codes(await create(root, undefined, { feature: 'blog' }))).toEqual(['feature-missing']);

    const withAppSidebar = await createProject({ ...TREE, 'src/app/components/Sidebar/Sidebar.tsx': 'export const Sidebar: React.FC = () => null;\n', 'src/app/components/Sidebar/index.ts': "export { Sidebar } from './Sidebar';\n" }, config);
    const refused = await create(withAppSidebar, undefined, { feature: 'docs', sidebar: true });
    expect(codes(refused)).toEqual(['layout-part-elsewhere']);
    expect(refused.issues?.[0]?.hint).toContain('"component update Sidebar --feature docs"');
    expect(await exists(withAppSidebar, layoutRel)).toBe(false);
  });

  it('is only used by its routes: check refuses it anywhere else', async () => {
    const root = await createProject(TREE, config);
    await create(root, undefined, { feature: 'docs' });
    const viewRel = 'src/features/docs/views/InstallationView/InstallationView.tsx';
    const text = await read(root, viewRel);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${root}/${viewRel}`, `import { DocsLayout } from '../../layouts/DocsLayout';\n${text.replace('<div className={styles.root} />', '<DocsLayout />')}`);
    expect(await errors(root)).toContain(`layout-import-outside-routes ${viewRel}`);
  });
});

describe('layout create: a named app layout', () => {
  it('creates a nested layout that nothing renders yet', async () => {
    const root = await createProject(TREE, config);
    const result = await create(root, 'DocsLayout');
    expect(codes(result)).toEqual([]);
    expect(result.summary).toBe('Layout "DocsLayout" created. Mount features in it with "feature create <name> --layout DocsLayout".');
    expect(await read(root, 'src/app/layouts/DocsLayout/DocsLayout.tsx')).toContain('export const DocsLayout: React.FC');
    expect(await read(root, 'src/app/router.tsx')).not.toContain('DocsLayout');
  });
});

describe('feature create --layout', () => {
  const mount = (root: string, name: string, layout: string, routePath?: string) =>
    featureCreateCommand.run({ cwd: root, args: { name }, options: { path: routePath, noMount: false, layout, dryRun: false } });

  it('moves a mounted feature inside the layout, and features under it share its route', async () => {
    const root = await createProject(TREE, config);
    await create(root, 'DocsLayout');
    const first = await mount(root, 'docs', 'DocsLayout');
    expect(codes(first)).toEqual([]);
    expect(first.summary).toBe('Feature "docs" already existed; mounted at /docs inside DocsLayout.');
    const router = await read(root, 'src/app/router.tsx');
    expect(router).toContain("{ path: 'docs', Component: DocsLayout, children: docsRoutes }");
    expect(router).toContain("import { DocsLayout } from './layouts/DocsLayout';");
    expect(router.match(/children: docsRoutes/g)).toHaveLength(1);

    // A second feature joins the same route: the layout stays mounted between them.
    const second = await mount(root, 'cli', 'DocsLayout', 'docs/cli');
    expect(codes(second)).toEqual([]);
    expect(await read(root, 'src/app/router.tsx')).toContain("{ path: 'docs', Component: DocsLayout, children: [{ children: docsRoutes }, { path: 'cli', children: cliRoutes }] }");

    // Running it again changes nothing.
    const again = await mount(root, 'docs', 'DocsLayout');
    expect(again.actions?.some((action) => action.type === 'skip' && action.message === 'docsRoutes already renders inside DocsLayout')).toBe(true);
    expect(await errors(root)).toEqual([]);
  });

  it('refuses a path outside the layout, a missing layout, RootLayout, and --no-mount', async () => {
    const root = await createProject(TREE, config);
    await create(root, 'DocsLayout');
    await mount(root, 'docs', 'DocsLayout');
    expect(codes(await mount(root, 'blog', 'DocsLayout', 'blog'))).toEqual(['layout-path-mismatch']);
    expect(codes(await mount(root, 'blog', 'GuideLayout'))).toEqual(['layout-missing']);
    expect(codes(await mount(root, 'blog', 'RootLayout'))).toEqual(['layout-is-root']);
    expect(codes(await featureCreateCommand.run({ cwd: root, args: { name: 'blog' }, options: { path: undefined, noMount: true, layout: 'DocsLayout', dryRun: false } }))).toEqual(['options-conflict']);
  });
});

describe('check: a nested layout repeating its parents', () => {
  const layoutFile = (name: string, parts: string[]) =>
    lines("import { Outlet } from 'react-router';", ...parts.map((part) => `import { ${part} } from '@/components/layout';`), '', `export const ${name}: React.FC = () => {`, `  return <div>${parts.map((part) => `<${part} />`).join('')}<Outlet /></div>;`, '};');
  const repeats = async (root: string) => (await checkStructure(root)).issues.filter((issue) => issue.code === 'layout-repeats-parent').map((issue) => issue.message);

  it('warns about a part an outer layout already renders: the root one, or the app layout a feature is mounted in', async () => {
    const tree = {
      ...TREE,
      'src/app/router.tsx': lines(
        "import { createBrowserRouter, type RouteObject } from 'react-router';",
        "import { docsRoutes } from '@/features/docs';",
        "import { RootLayout } from './layouts/RootLayout';",
        "import { ShellLayout } from './layouts/ShellLayout';",
        '',
        "const routes: RouteObject[] = [{ path: '/', Component: RootLayout, children: [{ path: 'docs', Component: ShellLayout, children: docsRoutes }] }];",
        '',
        'export const router = createBrowserRouter(routes);',
      ),
      'src/app/layouts/RootLayout/RootLayout.tsx': layoutFile('RootLayout', ['TopBar']),
      'src/app/layouts/ShellLayout/ShellLayout.tsx': layoutFile('ShellLayout', ['Sidebar']),
      'src/features/docs/layouts/DocsLayout/DocsLayout.tsx': layoutFile('DocsLayout', ['TopBar', 'Sidebar', 'Footer']),
    };
    const root = await createProject(tree, config);
    expect(await repeats(root)).toEqual([
      'DocsLayout renders TopBar, which RootLayout already renders around it: the page would show it twice.',
      'DocsLayout renders Sidebar, which ShellLayout already renders around it: the page would show it twice.',
    ]);
  });

  it('says nothing when each layout holds its own part', async () => {
    const root = await createProject(TREE, config);
    await create(root, undefined, { feature: 'docs', sidebar: true });
    expect(await repeats(root)).toEqual([]);
  });
});
