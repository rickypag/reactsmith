import { describe, expect, it, vi } from 'vitest';
import { featureCreateCommand } from '../../src/commands/feature/create/command.js';
import { createProject, exists, read } from '../helpers.js';

const router = { library: 'react-router', version: 7, mode: 'data' };

/** The router file init generates, with the not-found route. */
const APP_ROUTER = [
  "import { createBrowserRouter, type RouteObject } from 'react-router';",
  '',
  'const routes: RouteObject[] = [',
  '  {',
  "    path: '/',",
  '    children: [],',
  '  },',
  "  { path: '*', lazy: () => import('./views/NotFoundView') },",
  '];',
  '',
  'export const router = createBrowserRouter(routes);',
  '',
].join('\n');

interface CreateOptions {
  path?: string;
  noMount?: boolean;
  dryRun?: boolean;
  ask?: (question: string, defaultValue: string) => Promise<string>;
}

async function create(name: string, config: unknown, options: CreateOptions = {}, tree: Record<string, string> = {}) {
  const root = await createProject({ 'src/main.tsx': '', ...tree }, config);
  const result = await featureCreateCommand.run({
    cwd: root,
    args: { name },
    options: { path: options.path, noMount: options.noMount ?? false, layout: undefined, dryRun: options.dryRun ?? false },
    ask: options.ask,
  });
  return { root, result };
}

function actions(result: { actions?: { type: string; path: string }[] }): string[] {
  return (result.actions ?? []).map((a) => `${a.type} ${a.path}`);
}

describe('feature create', () => {
  it('creates the public API and an empty routes file when a router is configured', async () => {
    const { root, result } = await create('user-profile', { router, appFiles: 'app' });
    expect(result.ok).toBe(true);
    expect(actions(result)).toEqual([
      'create src/features/user-profile/index.ts',
      'create src/features/user-profile/routes.tsx',
      'todo src/app/router.tsx',
    ]);
    expect(await read(root, 'src/features/user-profile/index.ts')).toBe("export { userProfileRoutes } from './routes';\n");
    expect(await read(root, 'src/features/user-profile/routes.tsx')).toBe(
      "import type { RouteObject } from 'react-router';\n\nexport const userProfileRoutes: RouteObject[] = [];\n",
    );
    expect(result.actions?.[2]?.message).toBe(
      "mount the feature: add { path: 'user-profile', children: userProfileRoutes } to your app routes",
    );
  });

  it('creates only the public API without a router', async () => {
    const { root, result } = await create('auth', {});
    expect(actions(result)).toEqual(['create src/features/auth/index.ts', 'skip src/features/auth']);
    expect(await read(root, 'src/features/auth/index.ts')).toBe('// Public API of the "auth" feature: export what other code may use.\n');
    expect(result.summary).toBe('Feature "auth" created.');
  });

  it('follows customized names, folders and files', async () => {
    const config = {
      router,
      featureNaming: 'camelCase',
      folders: { features: 'modules' },
      featurePublicApi: 'public.ts',
      featureRoutes: 'routes/index.tsx',
    };
    const { root } = await create('userProfile', config, { noMount: true });
    expect(await read(root, 'src/modules/userProfile/public.ts')).toBe("export { userProfileRoutes } from './routes';\n");
    expect(await read(root, 'src/modules/userProfile/routes/index.tsx')).toContain('export const userProfileRoutes: RouteObject[] = [];');
  });

  it('writes nothing with --dry-run', async () => {
    const { root, result } = await create('auth', { router }, { dryRun: true, noMount: true });
    expect(result).toMatchObject({ ok: true, dryRun: true });
    expect(result.actions).toHaveLength(2);
    expect(await exists(root, 'src/features/auth')).toBe(false);
  });

  it.each([
    ['UserProfile', 'Use "user-profile" instead.'],
    ['user_profile', 'Use "user-profile" instead.'],
  ])('rejects the name %s', async (name, hint) => {
    const { root, result } = await create(name, {});
    const code = 'feature-name-invalid';
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ code, hint })]);
    expect(await exists(root, 'src/features')).toBe(false);
  });

  it('leaves an existing feature as it is', async () => {
    const { root, result } = await create('auth', {}, {}, { 'src/features/auth/index.ts': '// mine\n' });
    expect(result.ok).toBe(true);
    expect(actions(result)).toEqual(['skip src/features/auth']);
    expect(result.summary).toBe('Feature "auth" already exists; nothing changed.');
    expect(await read(root, 'src/features/auth/index.ts')).toBe('// mine\n');
  });

  it('stops on an invalid config', async () => {
    const { result } = await create('auth', { folders: { features: null } });
    expect(result.issues?.[0]?.code).toBe('config-invalid');
  });
});

describe('feature create: mounting', () => {
  const config = { router, appFiles: 'app' };
  const tree = { 'src/app/router.tsx': APP_ROUTER };

  it('mounts the feature under the root route, at the feature name by default', async () => {
    const { root, result } = await create('user-profile', config, {}, tree);
    expect(result.summary).toBe('Feature "user-profile" created and mounted at /user-profile.');
    expect(actions(result)).toContain('update src/app/router.tsx');
    expect(await read(root, 'src/app/router.tsx')).toBe(
      [
        "import { createBrowserRouter, type RouteObject } from 'react-router';",
        "import { userProfileRoutes } from '@/features/user-profile';",
        '',
        'const routes: RouteObject[] = [',
        '  {',
        "    path: '/',",
        '    children: [',
        "      { path: 'user-profile', children: userProfileRoutes },",
        '    ],',
        '  },',
        "  { path: '*', lazy: () => import('./views/NotFoundView') },",
        '];',
        '',
        'export const router = createBrowserRouter(routes);',
        '',
      ].join('\n'),
    );
  });

  it('asks for the base path when it can, and uses --path otherwise', async () => {
    const ask = vi.fn().mockResolvedValue('/account/');
    const asked = await create('user-profile', config, { ask }, tree);
    expect(ask).toHaveBeenCalledWith('Base route path for "user-profile"?', 'user-profile');
    expect(await read(asked.root, 'src/app/router.tsx')).toContain("{ path: 'account', children: userProfileRoutes }");

    const flagged = await create('user-profile', config, { path: 'settings/profile', ask }, tree);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await read(flagged.root, 'src/app/router.tsx')).toContain("{ path: 'settings/profile', children: userProfileRoutes }");
  });

  it('adds later features after the existing ones', async () => {
    const first = await create('docs', config, {}, tree);
    const text = await read(first.root, 'src/app/router.tsx');
    const second = await create('blog', config, {}, { 'src/app/router.tsx': text });
    const router = await read(second.root, 'src/app/router.tsx');
    expect(router).toContain(
      "      { path: 'docs', children: docsRoutes },\n      { path: 'blog', children: blogRoutes },\n",
    );
    expect(router).toContain("import { docsRoutes } from '@/features/docs';\nimport { blogRoutes } from '@/features/blog';");
  });

  it('refuses a path that is already used, writing nothing', async () => {
    const first = await create('docs', config, {}, tree);
    const text = await read(first.root, 'src/app/router.tsx');
    const { root, result } = await create('guides', config, { path: 'docs' }, { 'src/app/router.tsx': text });
    expect(result.issues).toEqual([expect.objectContaining({ code: 'route-path-taken' })]);
    expect(await exists(root, 'src/features/guides')).toBe(false);
  });

  it('mounts a feature at the root with --path "/", as a route without a path', async () => {
    const { root, result } = await create('overview', config, { path: '/' }, tree);
    expect(result.summary).toBe('Feature "overview" created and mounted at /.');
    const text = await read(root, 'src/app/router.tsx');
    expect(text).toContain('    children: [\n      { children: overviewRoutes },\n    ],');

    const rerun = await featureCreateCommand.run({ cwd: root, args: { name: 'overview' }, options: { path: undefined, noMount: false, layout: undefined, dryRun: false } });
    expect(rerun.actions?.[1]?.message).toBe('overviewRoutes already mounted at /');
  });

  it('mounts only one feature at the root, and other features next to it', async () => {
    const first = await create('overview', config, { path: '/' }, tree);
    const text = await read(first.root, 'src/app/router.tsx');
    const docs = await create('docs', config, {}, { 'src/app/router.tsx': text });
    expect(docs.result.ok).toBe(true);

    const { root, result } = await create('home', config, { path: '/' }, { 'src/app/router.tsx': text });
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'route-path-taken', message: 'Another feature is already mounted at the root in src/app/router.tsx.' }),
    ]);
    expect(await exists(root, 'src/features/home')).toBe(false);
  });

  it.each(['', '../x', 'a b'])('rejects the invalid path %j', async (routePath) => {
    const { result } = await create('docs', config, { path: routePath }, tree);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'route-path-invalid' })]);
  });

  it('leaves a todo when the router has another shape', async () => {
    const custom = "import { createBrowserRouter } from 'react-router';\nexport const router = createBrowserRouter(getRoutes());\n";
    const { root, result } = await create('docs', config, {}, { 'src/app/router.tsx': custom });
    expect(result.ok).toBe(true);
    expect(result.actions?.at(-1)).toMatchObject({ type: 'todo', path: 'src/app/router.tsx' });
    expect(await read(root, 'src/app/router.tsx')).toBe(custom);
  });

  it('is idempotent: running it again changes nothing', async () => {
    const first = await create('docs', config, {}, tree);
    const router = await read(first.root, 'src/app/router.tsx');
    const rerun = await featureCreateCommand.run({
      cwd: first.root,
      args: { name: 'docs' },
      options: { path: 'elsewhere', noMount: false, layout: undefined, dryRun: false },
    });
    expect(rerun.ok).toBe(true);
    expect(actions(rerun)).toEqual(['skip src/features/docs', 'skip src/app/router.tsx']);
    expect(rerun.actions?.[1]?.message).toBe('docsRoutes already mounted at /docs');
    expect(rerun.summary).toBe('Feature "docs" already exists; nothing changed.');
    expect(await read(first.root, 'src/app/router.tsx')).toBe(router);
  });

  it('mounts an existing feature that is not mounted yet, using its exported routes name', async () => {
    const feature = {
      'src/features/docs/index.ts': "export { guideRoutes } from './routes';\n",
      'src/features/docs/routes.tsx': 'export const guideRoutes: RouteObject[] = [];\n',
    };
    const ask = vi.fn().mockResolvedValue('guides');
    const { root, result } = await create('docs', config, { ask }, { ...tree, ...feature });
    expect(ask).toHaveBeenCalledOnce();
    expect(actions(result)).toEqual(['skip src/features/docs', 'update src/app/router.tsx']);
    expect(result.summary).toBe('Feature "docs" already existed; mounted at /guides.');
    expect(await read(root, 'src/app/router.tsx')).toContain("{ path: 'guides', children: guideRoutes }");
    expect(await read(root, 'src/features/docs/routes.tsx')).toBe(feature['src/features/docs/routes.tsx']);
  });

  it('does not mount an existing feature without a routes file', async () => {
    const { root, result } = await create('auth', config, {}, { ...tree, 'src/features/auth/index.ts': '' });
    expect(actions(result)).toEqual(['skip src/features/auth']);
    expect(await read(root, 'src/app/router.tsx')).toBe(APP_ROUTER);
  });

  it('leaves a todo when the routes file exports no routes array', async () => {
    const feature = { 'src/features/docs/routes.tsx': 'export default getRoutes();\n' };
    const { result } = await create('docs', config, {}, { ...tree, ...feature });
    expect(result.actions?.at(-1)).toEqual({
      type: 'todo',
      path: 'src/features/docs/routes.tsx',
      message: 'mount the feature by hand: no exported routes array was found in this file',
    });
  });

  it('does not mount with --no-mount', async () => {
    const { root, result } = await create('docs', config, { noMount: true }, tree);
    expect(await read(root, 'src/app/router.tsx')).toBe(APP_ROUTER);
    expect(result.summary).toBe('Feature "docs" created. Mount docsRoutes in src/app/router.tsx when it is ready.');
  });
});
