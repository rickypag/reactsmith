import { describe, expect, it } from 'vitest';
import { layoutCreateCommand } from '../../src/commands/layout/create/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const router = { library: 'react-router', version: 7, mode: 'data' };
const config = { router, appFiles: 'app' };
const layoutDir = 'src/app/layouts/RootLayout';

const ROUTER = [
  "import { createBrowserRouter, type RouteObject } from 'react-router';",
  "import { docsRoutes } from '@/features/docs';",
  '',
  'const routes: RouteObject[] = [',
  '  {',
  "    path: '/',",
  '    children: [',
  "      { path: 'docs', children: docsRoutes },",
  '    ],',
  '  },',
  "  { path: '*', lazy: () => import('./views/NotFoundView') },",
  '];',
  '',
  'export const router = createBrowserRouter(routes);',
  '',
].join('\n');

const lines = (...text: string[]) => `${text.join('\n')}\n`;

async function createLayout(options: { topbar?: boolean; sidebar?: boolean; dryRun?: boolean } = {}, tree: Record<string, string> = {}, cfg: object = config) {
  const root = await createProject({ 'src/app/router.tsx': ROUTER, ...tree }, cfg);
  const result = await layoutCreateCommand.run({
    cwd: root,
    args: { name: undefined },
    options: { feature: undefined, topbar: options.topbar ?? false, sidebar: options.sidebar ?? false, dryRun: options.dryRun ?? false },
  });
  return { root, result };
}

/** Issues about layouts and components: the test projects are not complete apps otherwise. */
async function structureIssues(root: string) {
  return (await checkStructure(root)).issues.filter((issue) => /^(layout|component)-/.test(issue.code) && issue.code !== 'component-unused').map((issue) => `${issue.code} ${issue.path}`);
}

describe('layout create', () => {
  it('creates a blank root layout and renders every page inside it, the not-found page too', async () => {
    const { root, result } = await createLayout();
    expect(result.ok).toBe(true);
    expect(result.actions?.map((a) => `${a.type} ${a.path}`)).toEqual([
      `create ${layoutDir}/RootLayout.tsx`,
      `create ${layoutDir}/RootLayout.module.css`,
      `create ${layoutDir}/index.ts`,
      'update src/app/router.tsx',
    ]);
    expect(await read(root, `${layoutDir}/RootLayout.tsx`)).toBe(
      lines(
        "import { Outlet } from 'react-router';",
        "import styles from './RootLayout.module.css';",
        '',
        'export const RootLayout: React.FC = () => {',
        '  return (',
        '    <div className={styles.root}>',
        '      <main className={styles.main}>',
        '        <Outlet />',
        '      </main>',
        '    </div>',
        '  );',
        '};',
      ),
    );
    expect(await read(root, 'src/app/router.tsx')).toBe(
      lines(
        "import { createBrowserRouter, type RouteObject } from 'react-router';",
        "import { docsRoutes } from '@/features/docs';",
        "import { RootLayout } from './layouts/RootLayout';",
        '',
        'const routes: RouteObject[] = [',
        '  {',
        "    path: '/',",
        '    Component: RootLayout,',
        '    children: [',
        "      { path: 'docs', children: docsRoutes },",
        "      { path: '*', lazy: () => import('./views/NotFoundView') },",
        '    ],',
        '  },',
        '];',
        '',
        'export const router = createBrowserRouter(routes);',
      ),
    );
    expect(await structureIssues(root)).toEqual([]);
  });

  it('adds a top bar and a sidebar as app components, with semantic roots', async () => {
    const { root, result } = await createLayout({ topbar: true, sidebar: true });
    expect(result.ok).toBe(true);
    expect(await read(root, `${layoutDir}/RootLayout.tsx`)).toBe(
      lines(
        "import { Outlet } from 'react-router';",
        "import { TopBar } from '../../components/TopBar';",
        "import { Sidebar } from '../../components/Sidebar';",
        "import styles from './RootLayout.module.css';",
        '',
        'export const RootLayout: React.FC = () => {',
        '  return (',
        '    <div className={styles.root}>',
        '      <TopBar />',
        '      <div className={styles.body}>',
        '        <Sidebar />',
        '        <main className={styles.main}>',
        '          <Outlet />',
        '        </main>',
        '      </div>',
        '    </div>',
        '  );',
        '};',
      ),
    );
    // Full screen height, and only main scrolls: the top bar and the sidebar stay in place.
    expect(await read(root, `${layoutDir}/RootLayout.module.css`)).toBe(
      lines(
        '.root {',
        '  display: flex;',
        '  flex-direction: column;',
        '  height: 100vh;',
        '}',
        '',
        '.body {',
        '  display: flex;',
        '  flex: 1;',
        '  min-height: 0;',
        '}',
        '',
        '.main {',
        '  flex: 1;',
        '  min-width: 0;',
        '  overflow: auto;',
        '  padding: var(--space-6);',
        '}',
      ),
    );
    expect(await read(root, 'src/app/components/TopBar/TopBar.tsx')).toContain('<header className={styles.root} />');
    expect(await read(root, 'src/app/components/TopBar/TopBar.module.css')).toBe(
      lines(
        '.root {',
        '  display: flex;',
        '  flex-direction: row;',
        '  gap: var(--space-2);',
        '  align-items: center;',
        '  justify-content: space-between;',
        '  padding: 0 var(--space-4);',
        '  flex-shrink: 0;',
        '  min-height: 3.5rem;',
        '  border-bottom: 1px solid var(--color-border);',
        '}',
      ),
    );
    expect(await read(root, 'src/app/components/Sidebar/Sidebar.tsx')).toContain('<aside className={styles.root} />');
    expect(await read(root, 'src/app/components/Sidebar/Sidebar.module.css')).toContain(
      '  padding: var(--space-4);\n  flex-shrink: 0;\n  width: 15rem;\n  overflow: auto;\n  border-right: 1px solid var(--color-border);\n',
    );
    expect(await structureIssues(root)).toEqual([]);
  });

  it('puts the sidebar next to the pages without a top bar, with Tailwind classes', async () => {
    const { root } = await createLayout({ sidebar: true }, {}, { ...config, styles: 'tailwind' });
    expect(await read(root, `${layoutDir}/RootLayout.styles.ts`)).toBe(
      "export const styles = {\n  root: 'flex flex-row h-screen',\n  main: 'flex-1 min-w-0 overflow-auto p-6',\n};\n",
    );
    expect(await read(root, 'src/app/components/Sidebar/Sidebar.styles.ts')).toBe(
      "export const styles = {\n  root: 'flex flex-col gap-2 p-4 shrink-0 w-60 overflow-auto border-r border-border',\n};\n",
    );
    expect(await read(root, `${layoutDir}/RootLayout.tsx`)).toContain('      <Sidebar />\n      <main className={styles.main}>');
    expect(await structureIssues(root)).toEqual([]);
  });

  it('reuses an existing top bar', async () => {
    const topBar = {
      'src/app/components/TopBar/TopBar.tsx': 'export const TopBar: React.FC = () => <header />;\n',
      'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
    };
    const { root, result } = await createLayout({ topbar: true }, topBar);
    expect(result.actions).toContainEqual({ type: 'skip', path: 'src/app/components/TopBar', message: 'TopBar already exists, it is reused' });
    expect(await read(root, 'src/app/components/TopBar/TopBar.tsx')).toBe(topBar['src/app/components/TopBar/TopBar.tsx']);
  });

  it('refuses when a layout exists or the "/" route renders something, writing nothing', async () => {
    const codes = async (tree: Record<string, string>, cfg?: object) => (await createLayout({}, tree, cfg)).result.issues?.map((issue) => issue.code);
    expect(await codes({ [`${layoutDir}/RootLayout.tsx`]: '' })).toEqual(['layout-exists']);
    expect(await codes({ 'src/app/router.tsx': ROUTER.replace("path: '/',", "path: '/', Component: Shell,") })).toEqual(['layout-route-taken']);
    expect(await codes({ 'src/app/router.tsx': "const routes = [{ path: 'docs' }];\n" })).toEqual(['app-router-unsupported']);
    expect(await codes({}, { appFiles: 'app' })).toEqual(['router-not-configured']);
  });
});

describe('check: layouts', () => {
  it('requires exactly one <Outlet /> and the usual layout files', async () => {
    const root = await createProject(
      {
        'src/app/layouts/Shell/Shell.tsx': 'export const Shell: React.FC = () => <div />;\n',
        'src/app/layouts/Shell/extra.ts': '',
        'src/app/layouts/Loose.tsx': '',
      },
      config,
    );
    expect(await structureIssues(root)).toEqual([
      'layout-not-in-folder src/app/layouts/Loose.tsx',
      'layout-unexpected-file src/app/layouts/Shell/extra.ts',
      'layout-outlet src/app/layouts/Shell/Shell.tsx',
      'layout-entry-missing src/app/layouts/Shell',
    ]);
  });
});
