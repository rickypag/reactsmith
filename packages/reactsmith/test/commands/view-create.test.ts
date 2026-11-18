import { describe, expect, it, vi } from 'vitest';
import { viewCreateCommand } from '../../src/commands/view/create/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const router = { library: 'react-router', version: 7, mode: 'data' };
const config = { router, appFiles: 'app' };

/** A feature as "feature create docs" makes it, mounted at /docs. */
const DOCS = {
  'src/features/docs/index.ts': "export { docsRoutes } from './routes';\n",
  'src/features/docs/routes.tsx': "import type { RouteObject } from 'react-router';\n\nexport const docsRoutes: RouteObject[] = [];\n",
  'src/app/router.tsx': [
    "import { createBrowserRouter, type RouteObject } from 'react-router';",
    "import { docsRoutes } from '@/features/docs';",
    '',
    "const routes: RouteObject[] = [{ path: '/', children: [{ path: 'docs', children: docsRoutes }] }];",
    '',
    'export const router = createBrowserRouter(routes);',
    '',
  ].join('\n'),
};

interface Options {
  feature?: string;
  path?: string;
  index?: boolean;
  loader?: boolean;
  empty?: boolean;
  dryRun?: boolean;
  ask?: (question: string, defaultValue: string) => Promise<string>;
}

async function createView(name: string, options: Options = {}, tree: Record<string, string> = DOCS, cfg: unknown = config) {
  const root = await createProject(tree, cfg);
  const result = await viewCreateCommand.run({
    cwd: root,
    args: { name },
    options: {
      feature: options.feature ?? 'docs',
      path: options.path,
      index: options.index ?? false,
      loader: options.loader ?? false,
      empty: options.empty ?? false,
      dryRun: options.dryRun ?? false,
    },
    ask: options.ask,
  });
  return { root, result };
}

describe('view create', () => {
  it('creates the view and adds its route, at the kebab-case name by default', async () => {
    const { root, result } = await createView('Settings');
    expect(result.ok).toBe(true);
    expect(result.actions?.map((a) => `${a.type} ${a.path}`)).toEqual([
      'create src/features/docs/views/SettingsView/SettingsView.tsx',
      'create src/features/docs/views/SettingsView/SettingsView.module.css',
      'create src/features/docs/views/SettingsView/index.ts',
      'update src/features/docs/routes.tsx',
    ]);
    expect(await read(root, 'src/features/docs/views/SettingsView/SettingsView.tsx')).toBe(
      [
        "import styles from './SettingsView.module.css';",
        '',
        'export const SettingsView: React.FC = () => {',
        '  return (',
        '    <div className={styles.root}>',
        '      <h1>Settings</h1>',
        '    </div>',
        '  );',
        '};',
        '',
      ].join('\n'),
    );
    // The view's root lays out its content, so the page can grow: other elements go next to the heading.
    expect(await read(root, 'src/features/docs/views/SettingsView/SettingsView.module.css')).toContain('.root {\n  display: flex;');
    expect(await read(root, 'src/features/docs/views/SettingsView/index.ts')).toBe(
      "export { SettingsView as Component } from './SettingsView';\n",
    );
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain(
      "export const docsRoutes: RouteObject[] = [\n  { path: 'settings', lazy: () => import('./views/SettingsView') },\n];",
    );
    expect(result.summary).toBe('View "SettingsView" created at /docs/settings.');
  });

  it('creates an empty view with --empty: only its root, which check accepts; an existing view refuses it', async () => {
    const { root, result } = await createView('Settings', { empty: true });
    expect(result.ok).toBe(true);
    expect(await read(root, 'src/features/docs/views/SettingsView/SettingsView.tsx')).toBe(
      ["import styles from './SettingsView.module.css';", '', 'export const SettingsView: React.FC = () => {', '  return <div className={styles.root} />;', '};', ''].join('\n'),
    );
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    const tree = { ...DOCS, 'src/features/docs/routes.tsx': await read(root, 'src/features/docs/routes.tsx'), 'src/features/docs/views/SettingsView/SettingsView.tsx': '' };
    expect((await createView('Settings', { empty: true }, tree)).result.issues?.[0]?.message).toContain('--empty only comes with a new view');
  });

  it('accepts the name with or without the suffix, in any casing', async () => {
    for (const name of ['SettingsView', 'settings', 'settings-view']) {
      const { root } = await createView(name);
      expect(await exists(root, 'src/features/docs/views/SettingsView/SettingsView.tsx')).toBe(true);
    }
  });

  it('keeps acronyms in the name', async () => {
    const { root } = await createView('CombinedGraphQLErrors');
    expect(await exists(root, 'src/features/docs/views/CombinedGraphQLErrorsView/CombinedGraphQLErrorsView.tsx')).toBe(true);
  });

  it('creates the index route with --index', async () => {
    const { root, result } = await createView('Overview', { index: true });
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain("{ index: true, lazy: () => import('./views/OverviewView') }");
    expect(result.summary).toBe('View "OverviewView" created at /docs.');
  });

  it('asks for the path when it can, and uses --path otherwise', async () => {
    const ask = vi.fn().mockResolvedValue(':slug');
    const { root } = await createView('Article', { ask });
    expect(ask).toHaveBeenCalledWith('Route path for "ArticleView"?', 'article');
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain("{ path: ':slug', lazy: () => import('./views/ArticleView') }");

    const flagged = await createView('Article', { path: 'posts/:id', ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await read(flagged.root, 'src/features/docs/routes.tsx')).toContain("path: 'posts/:id'");
  });

  it('adds a loader with --loader', async () => {
    const { root } = await createView('Settings', { loader: true });
    expect(await read(root, 'src/features/docs/views/SettingsView/index.ts')).toBe(
      "export { SettingsView as Component } from './SettingsView';\nexport { loader } from './loader';\n",
    );
    expect(await read(root, 'src/features/docs/views/SettingsView/loader.ts')).toContain('export const loader = async');
  });

  it('says when the feature is not mounted yet', async () => {
    const { result } = await createView('Settings', {}, { ...DOCS, 'src/app/router.tsx': '' });
    expect(result.summary).toBe('View "SettingsView" created at "settings" in feature "docs", which is not mounted in the app router yet.');
  });

  it('follows customized folders and suffix', async () => {
    const custom = { ...config, featureFolders: { views: 'pages' }, viewSuffix: 'Page' };
    const { root } = await createView('Settings', {}, DOCS, custom);
    expect(await exists(root, 'src/features/docs/pages/SettingsPage/SettingsPage.tsx')).toBe(true);
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain("import('./pages/SettingsPage')");
  });

  it('produces files that pass check', async () => {
    const { root } = await createView('Settings', { loader: true });
    const { issues } = await checkStructure(root);
    expect(issues.filter((issue) => issue.code.startsWith('view-'))).toEqual([]);
  });

  it('writes nothing with --dry-run', async () => {
    const { root, result } = await createView('Settings', { dryRun: true });
    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect(await exists(root, 'src/features/docs/views')).toBe(false);
    expect(await read(root, 'src/features/docs/routes.tsx')).toBe(DOCS['src/features/docs/routes.tsx']);
  });

  it.each([
    ['no router', 'Settings', {}, DOCS, { appFiles: 'app' }, 'router-not-configured'],
    ['views disabled', 'Settings', {}, DOCS, { ...config, featureFolders: { views: null } }, 'views-disabled'],
    ['unknown feature', 'Settings', { feature: 'blog' }, DOCS, config, 'feature-not-found'],
    ['no routes file', 'Settings', {}, { 'src/features/docs/index.ts': '' }, config, 'feature-routes-missing'],
    ['bad name', '123', {}, DOCS, config, 'view-name-invalid'],
    ['bad path', 'Settings', { path: '../up' }, DOCS, config, 'route-path-invalid'],
    ['--index with --path', 'Settings', { index: true, path: 'x' }, DOCS, config, 'options-conflict'],
  ])('refuses: %s', async (_, name, options, tree, cfg, code) => {
    const { root, result } = await createView(name, options, tree, cfg);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code })]);
    expect(await exists(root, 'src/features/docs/views')).toBe(false);
  });

  it('refuses a taken path, a second index route and a loader for an existing view', async () => {
    const first = await createView('Settings', { index: true });
    const tree = {
      ...DOCS,
      'src/features/docs/routes.tsx': await read(first.root, 'src/features/docs/routes.tsx'),
      'src/features/docs/views/SettingsView/SettingsView.tsx': '',
    };
    expect((await createView('Other', { index: true }, tree)).result.issues?.[0]?.code).toBe('index-route-exists');
    expect((await createView('Settings', { path: 'other', loader: true }, tree)).result.issues?.[0]?.code).toBe('view-exists');

    const withPath = await createView('Guide', { path: 'guide' });
    const taken = { ...DOCS, 'src/features/docs/routes.tsx': await read(withPath.root, 'src/features/docs/routes.tsx') };
    expect((await createView('Other', { path: 'guide' }, taken)).result.issues?.[0]?.code).toBe('route-path-taken');
  });
});

describe('view create, run again on an existing view', () => {
  /** Two views of docs: Introduction at "introduction", Installation at "installation", and a link to the first. */
  async function docs() {
    const { root } = await createView('Introduction', { path: 'introduction' });
    const run = (name: string, options: Options) =>
      viewCreateCommand.run({ cwd: root, args: { name }, options: { feature: 'docs', path: options.path, index: options.index ?? false, loader: false, empty: false, dryRun: false } });
    await run('Installation', { path: 'installation' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${root}/src/features/docs/constants.ts`, "export const START = '/docs/introduction';\n");
    return { root, run };
  }

  it('moves its route to the index or another path, and points out the links to the old URL', async () => {
    const { root, run } = await docs();
    const moved = await run('Introduction', { index: true });
    expect(moved.summary).toBe('View "IntroductionView" moved to /docs.');
    expect(moved.actions).toEqual([{ type: 'update', path: 'src/features/docs/routes.tsx', message: 'moved the route of "IntroductionView": "introduction" → (index)' }]);
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain("{ index: true, lazy: () => import('./views/IntroductionView') },");
    expect(moved.issues).toEqual([expect.objectContaining({ code: 'route-old-links', message: 'A file still links to /docs/introduction, which is now /docs: src/features/docs/constants.ts.' })]);

    // Back to a path; the same place again changes nothing.
    expect((await run('Introduction', { path: 'intro' })).actions?.[0]?.message).toBe('moved the route of "IntroductionView": (index) → "intro"');
    expect((await run('Introduction', { path: 'intro' })).actions).toEqual([{ type: 'skip', path: 'src/features/docs/routes.tsx', message: '"IntroductionView" is already at "intro"' }]);
  });

  it('refuses a place another view has, and without --index or --path changes nothing', async () => {
    const { root, run } = await docs();
    expect((await run('Introduction', { path: 'installation' })).issues?.[0]?.code).toBe('route-path-taken');
    const before = await read(root, 'src/features/docs/routes.tsx');
    const nothing = await run('Introduction', {});
    expect(nothing.summary).toBe('View "IntroductionView" already exists; nothing changed. Pass --index or --path to move its route.');
    expect(await read(root, 'src/features/docs/routes.tsx')).toBe(before);
  });
});

describe('view create --path "*"', () => {
  it('makes the page for the URLs of the feature that no other route matches, and keeps it last', async () => {
    const { root } = await createView('NotFound', { path: '*' });
    const result = await viewCreateCommand.run({ cwd: root, args: { name: 'Guide' }, options: { feature: 'docs', path: 'guide', index: false, loader: false, empty: false, dryRun: false } });
    expect(result.issues ?? []).toEqual([]);
    expect(await read(root, 'src/features/docs/routes.tsx')).toContain("  { path: 'guide', lazy: () => import('./views/GuideView') },\n  { path: '*', lazy: () => import('./views/NotFoundView') },\n];");
  });
});
