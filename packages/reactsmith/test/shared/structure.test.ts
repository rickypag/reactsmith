import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { createProject, VITE_TREE } from '../helpers.js';

/** Component folder rules are left out: these tests use loose component files as fixtures (see components.test.ts). */
async function check(tree: Record<string, string>, config: unknown = {}) {
  const root = await createProject(tree, config);
  return (await checkStructure(root)).issues.filter((issue) => !issue.code.startsWith('component-'));
}

function summary(issues: { severity: string; code: string; path?: string }[]): string[] {
  return issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path ?? ''}`.trim());
}

describe('fresh Vite project', () => {
  it('only warns that appFiles is undecided', async () => {
    const issues = await check(VITE_TREE);
    expect(summary(issues)).toEqual(['warning app-files-undecided src']);
    expect(issues[0]?.message).toContain('App.css, App.tsx');
  });

  it('passes cleanly with appFiles: "root"', async () => {
    expect(await check(VITE_TREE, { appFiles: 'root' })).toEqual([]);
  });

  it('errors with appFiles: "app" until the files are moved', async () => {
    expect(summary(await check(VITE_TREE, { appFiles: 'app' }))).toEqual(['error app-files-location src']);

    const moved = { 'src/main.tsx': '', 'src/index.css': '', 'src/app/App.tsx': '', 'src/app/App.css': '' };
    expect(await check(moved, { appFiles: 'app' })).toEqual([]);
  });

  it('also warns that the config is missing when there is none', async () => {
    const root = await createProject(VITE_TREE);
    const { issues } = await checkStructure(root);
    expect(summary(issues)).toEqual([`warning config-missing ${CONFIG_FILE}`, 'warning app-files-undecided src']);
  });
});

describe('top-level folders', () => {
  const config = { appFiles: 'root' };

  it('accepts all default folders and loose files', async () => {
    const tree = Object.fromEntries(
      ['app', 'assets', 'components', 'config', 'features', 'hooks', 'lib', 'stores', 'testing', 'types', 'utils'].map(
        (name) => [`src/${name}/`, ''],
      ),
    );
    expect(await check({ ...tree, 'src/main.tsx': '', 'src/vite-env.d.ts': '' }, config)).toEqual([]);
  });

  it('reports unknown folders as errors by default', async () => {
    const issues = await check({ 'src/services/': '' }, config);
    expect(summary(issues)).toEqual(['error unknown-folder src/services']);
    expect(issues[0]?.hint).toContain('"services": "services"');
  });

  it('respects unknownFolders: "warn" and "allow"', async () => {
    expect(summary(await check({ 'src/services/': '' }, { ...config, unknownFolders: 'warn' }))).toEqual([
      'warning unknown-folder src/services',
    ]);
    expect(await check({ 'src/services/': '' }, { ...config, unknownFolders: 'allow' })).toEqual([]);
  });

  it('accepts custom and renamed folders, and rejects the old name', async () => {
    const custom = { ...config, folders: { features: 'apps', services: 'services' } };
    expect(await check({ 'src/apps/': '', 'src/services/': '' }, custom)).toEqual([]);
    expect(summary(await check({ 'src/features/': '' }, custom))).toEqual(['error unknown-folder src/features']);
  });

  it('rejects disabled folders', async () => {
    expect(summary(await check({ 'src/stores/': '' }, { ...config, folders: { stores: null } }))).toEqual([
      'error unknown-folder src/stores',
    ]);
  });

  it('hints when a folder only differs by case', async () => {
    const issues = await check({ 'src/Components/': '' }, config);
    expect(issues[0]?.hint).toContain('rename it to "components"');
  });

  it('uses a custom srcDir', async () => {
    expect(await check({ 'app/src/components/': '' }, { ...config, srcDir: 'app/src' })).toEqual([]);
    expect(summary(await check({ 'src/components/': '' }, { ...config, srcDir: 'app/src' }))).toEqual([
      'error src-missing app/src',
    ]);
  });
});

describe('features', () => {
  const config = { appFiles: 'root' };

  /** These tests are about names and folders: the unused-feature warnings are tested below. */
  async function errors(tree: Record<string, string>, cfg: unknown = config) {
    return (await check(tree, cfg)).filter((issue) => issue.severity === 'error');
  }

  it('accepts kebab-case features with known subfolders', async () => {
    const tree = {
      'src/features/auth/components/LoginForm.tsx': '',
      'src/features/auth/stores/': '',
      'src/features/user-profile/hooks/': '',
      'src/features/user-profile/index.ts': '',
    };
    expect(await errors(tree)).toEqual([]);
  });

  it('enforces kebab-case by default', async () => {
    const issues = await errors({ 'src/features/userProfile/': '' });
    expect(summary(issues)).toEqual(['error feature-naming src/features/userProfile']);
    expect(issues[0]?.hint).toContain('"user-profile"');
  });

  it('enforces camelCase when configured', async () => {
    const camel = { ...config, featureNaming: 'camelCase' };
    expect(await errors({ 'src/features/userProfile/': '' }, camel)).toEqual([]);
    const issues = await errors({ 'src/features/user-profile/': '' }, camel);
    expect(summary(issues)).toEqual(['error feature-naming src/features/user-profile']);
    expect(issues[0]?.hint).toContain('"userProfile"');
  });

  it('reports unknown feature subfolders and accepts configured ones', async () => {
    expect(summary(await errors({ 'src/features/auth/constants/': '' }))).toEqual([
      'error unknown-feature-folder src/features/auth/constants',
    ]);
    const custom = { ...config, featureFolders: { constants: 'constants' } };
    expect(await errors({ 'src/features/auth/constants/': '' }, custom)).toEqual([]);
  });

  it('allows the folder of a nested feature file', async () => {
    const tree = { 'src/features/auth/routes/index.tsx': '' };
    expect(summary(await errors(tree))).toEqual(['error unknown-feature-folder src/features/auth/routes']);
    expect(await errors(tree, { ...config, featureRoutes: 'routes/index.tsx' })).toEqual([]);
  });

  it('reports files directly inside the features folder', async () => {
    expect(summary(await errors({ 'src/features/index.ts': '' }))).toEqual(['error unexpected-file src/features/index.ts']);
  });

  it('checks the renamed features folder', async () => {
    const renamed = { ...config, folders: { features: 'apps' } };
    expect(summary(await errors({ 'src/apps/Auth/': '' }, renamed))).toEqual(['error feature-naming src/apps/Auth']);
  });
});

describe('app folder', () => {
  const config = { appFiles: 'app' };

  it('accepts the configured app folders and reports others', async () => {
    const tree = { 'src/app/App.tsx': '', 'src/app/components/Sidebar.tsx': '', 'src/app/widgets/': '' };
    expect(summary(await check(tree, config))).toEqual(['error unknown-app-folder src/app/widgets']);
    expect(await check(tree, { ...config, appFolders: { widgets: 'widgets' } })).toEqual([]);
  });

  it('follows the unknownFolders policy', async () => {
    expect(summary(await check({ 'src/app/widgets/': '' }, { ...config, unknownFolders: 'warn' }))).toEqual([
      'warning unknown-app-folder src/app/widgets',
    ]);
  });
});

describe('feature files', () => {
  const router = { library: 'react-router', version: 7, mode: 'data' };

  it('warns that a feature without a public API is unused', async () => {
    const issues = await check({ 'src/features/auth/components/': '' }, { appFiles: 'root' });
    expect(summary(issues)).toEqual(['warning feature-public-api-missing src/features/auth']);
    expect(issues[0]?.message).toBe(
      'Feature "auth" has no public API file index.ts, so it is unused: nothing outside the feature can import it.',
    );
  });

  it('says so when a feature without a public API is reached through deep imports', async () => {
    const tree = {
      'src/features/auth/components/Login.tsx': '',
      'src/main.tsx': "import { Login } from '@/features/auth/components/Login'",
    };
    const issues = await check(tree, { appFiles: 'root' });
    expect(summary(issues)).toEqual([
      'error feature-deep-import src/main.tsx',
      'warning feature-public-api-missing src/features/auth',
    ]);
    expect(issues[1]?.message).toBe(
      'Feature "auth" has no public API file index.ts, other code can only reach it through deep imports.',
    );
  });

  it('warns about a missing routes file only when a router is configured', async () => {
    const tree = { 'src/features/auth/index.ts': '', 'src/app/router.tsx': "import { authRoutes } from '@/features/auth'" };
    expect(await check(tree, { appFiles: 'app' })).toEqual([]);
    expect(summary(await check(tree, { appFiles: 'app', router }))).toEqual(['warning feature-routes-missing src/features/auth']);
    expect(await check({ ...tree, 'src/features/auth/routes.tsx': '' }, { appFiles: 'app', router })).toEqual([]);
  });

  it('warns about a feature that nothing imports', async () => {
    const issues = await check({ 'src/features/auth/index.ts': '' }, { appFiles: 'root' });
    expect(summary(issues)).toEqual(['warning feature-unused src/features/auth']);
    expect(issues[0]?.message).toBe('Feature "auth" is unused: nothing outside it imports "@/features/auth".');
  });

  it('does not count imports from inside the feature', async () => {
    const tree = {
      'src/features/auth/index.ts': "export * from './components/Login'",
      'src/features/auth/components/Login.tsx': '',
    };
    expect(summary(await check(tree, { appFiles: 'root' }))).toEqual(['warning feature-unused src/features/auth']);
  });
});

describe('import rules', () => {
  const config = { appFiles: 'app' };
  const features = {
    'src/features/auth/index.ts': '',
    'src/features/auth/components/LoginForm.tsx': '',
    'src/features/dashboard/index.ts': '',
    'src/app/router.tsx': "import { a } from '@/features/auth'\nimport { d } from '@/features/dashboard'",
  };

  it('accepts imports through the public API, in every style', async () => {
    const tree = {
      ...features,
      'src/features/dashboard/components/Home.tsx': [
        "import { a } from '@/features/auth'",
        "import { b } from '@/features/auth/index'",
        "import { c } from '../../auth/index.ts'",
        "import { d } from '../../auth/index.js'",
        "import { e } from '../../auth'",
      ].join('\n'),
    };
    expect(await check(tree, config)).toEqual([]);
  });

  it('reports deep imports into another feature', async () => {
    const tree = {
      ...features,
      'src/features/dashboard/components/Home.tsx': "import { LoginForm } from '@/features/auth/components/LoginForm'",
      'src/main.tsx': "import { LoginForm } from './features/auth/components/LoginForm'",
    };
    const issues = await check(tree, config);
    expect(summary(issues)).toEqual([
      'error feature-deep-import src/features/dashboard/components/Home.tsx',
      'error feature-deep-import src/main.tsx',
    ]);
    expect(issues[0]?.hint).toBe('Import from "@/features/auth" instead, and export what you need from its index.ts.');
  });

  it('allows deep imports inside the same feature', async () => {
    const tree = { ...features, 'src/features/auth/index.ts': "export * from '@/features/auth/components/LoginForm'" };
    expect(await check(tree, config)).toEqual([]);
  });

  it('allows deep imports when the rule is off', async () => {
    const tree = { ...features, 'src/main.tsx': "import x from '@/features/auth/components/LoginForm'" };
    expect(await check(tree, { ...config, imports: { featurePublicApiOnly: false } })).toEqual([]);
  });

  it('uses a custom public API file', async () => {
    const tree = {
      'src/features/auth/public.ts': '',
      'src/app/router.tsx': "import { a } from '@/features/auth/public'\nimport { b } from '@/features/auth'",
    };
    const issues = await check(tree, { ...config, featurePublicApi: 'public.ts' });
    expect(summary(issues)).toEqual(['error feature-deep-import src/app/router.tsx']);
    expect(issues[0]?.hint).toContain('"@/features/auth/public"');
  });

  it('reports features importing from the app folder', async () => {
    const tree = {
      ...features,
      'src/app/components/Sidebar.tsx': '',
      'src/features/auth/components/LoginForm.tsx': "import { Sidebar } from '@/app/components/Sidebar'",
    };
    expect(summary(await check(tree, config))).toEqual(['error feature-imports-app src/features/auth/components/LoginForm.tsx']);
    expect(await check(tree, { ...config, imports: { featuresImportApp: true } })).toEqual([]);
  });

  it('reports shared folders importing features, even through the public API', async () => {
    const tree = {
      ...features,
      'src/components/Header.tsx': "import { a } from '@/features/auth'",
      'src/hooks/useUser.ts': "import { LoginForm } from '../features/auth/components/LoginForm'",
    };
    const issues = await check(tree, config);
    expect(summary(issues)).toEqual([
      'error shared-imports-feature src/components/Header.tsx',
      'error shared-imports-feature src/hooks/useUser.ts',
    ]);
    expect(issues[0]?.message).toBe('Shared folder "components" imports "@/features/auth" from feature "auth".');
    expect(await check(tree, { ...config, imports: { sharedImportFeatures: true, featurePublicApiOnly: false } })).toEqual([]);
  });

  it('reports shared folders importing from the app folder', async () => {
    const tree = {
      ...features,
      'src/app/components/Sidebar.tsx': '',
      'src/lib/menu.ts': "import { Sidebar } from '@/app/components/Sidebar'",
    };
    expect(summary(await check(tree, config))).toEqual(['error shared-imports-app src/lib/menu.ts']);
    expect(await check(tree, { ...config, imports: { sharedImportApp: true } })).toEqual([]);
  });

  it('lets root files such as main.tsx import anything', async () => {
    const tree = { ...features, 'src/main.tsx': "import { App } from './app/App'\nimport { a } from '@/features/auth'" };
    expect(await check(tree, config)).toEqual([]);
  });

  it('exempts tests, stories and the testing folder', async () => {
    const tree = {
      ...features,
      'src/app/provider.tsx': '',
      'src/testing/test-utils.tsx': "import { AppProvider } from '@/app/provider'\nimport { LoginForm } from '@/features/auth/components/LoginForm'",
      'src/features/auth/components/LoginForm.test.tsx': "import { AppProvider } from '@/app/provider'",
      'src/components/Header.stories.tsx': "import { a } from '@/features/auth'",
      'src/features/dashboard/components/Home.spec.ts': "import { LoginForm } from '@/features/auth/components/LoginForm'",
    };
    expect(await check(tree, config)).toEqual([]);
  });

  it('does not count tests as using a feature', async () => {
    const tree = {
      'src/features/auth/index.ts': '',
      'src/testing/fixtures.ts': "import { a } from '@/features/auth'",
      'src/features/users/index.ts': '',
      'src/features/users/users.test.ts': "import { a } from '@/features/auth'",
    };
    expect(summary(await check(tree, { appFiles: 'root' }))).toEqual([
      'warning feature-unused src/features/auth',
      'warning feature-unused src/features/users',
    ]);
  });

  it('ignores packages and other aliases', async () => {
    const tree = { ...features, 'src/features/auth/components/LoginForm.tsx': "import React from 'react'\nimport x from '~/app/x'" };
    expect(await check(tree, config)).toEqual([]);
  });
});

describe('app router file', () => {
  const router = { library: 'react-router', version: 7, mode: 'data' };

  it('warns when a router is configured but the router file is missing', async () => {
    const issues = await check({ 'src/app/App.tsx': '' }, { appFiles: 'app', router });
    expect(summary(issues)).toEqual(['warning app-router-missing src/app']);
    expect(issues[0]?.message).toBe('A router is configured, but src/app/router.tsx does not exist.');
    expect(await check({ 'src/app/router.tsx': '' }, { appFiles: 'app', router })).toEqual([]);
  });

  it('ignores the router file when no router is configured or the check is disabled', async () => {
    expect(await check({ 'src/app/App.tsx': '' }, { appFiles: 'app' })).toEqual([]);
    expect(await check({ 'src/app/App.tsx': '' }, { appFiles: 'app', router, appRouter: null })).toEqual([]);
  });

  it('allows the folder of a nested router file', async () => {
    const config = { appFiles: 'app', router, appRouter: 'routing/router.tsx' };
    expect(await check({ 'src/app/routing/router.tsx': '' }, config)).toEqual([]);
  });
});

describe('feature cycles', () => {
  it('warns when features import each other', async () => {
    const tree = {
      'src/features/auth/index.ts': "export { Profile } from '@/features/users'",
      'src/features/users/index.ts': "export { Login } from '@/features/auth'",
      'src/features/dashboard/index.ts': "export { Login } from '@/features/auth'",
      'src/app/router.tsx': "import { d } from '@/features/dashboard'",
    };
    const issues = await check(tree, { appFiles: 'app' });
    expect(summary(issues)).toEqual(['warning feature-cycle src/features']);
    expect(issues[0]?.message).toBe('Features import each other in a loop: auth → users → auth.');
  });

  it('accepts one-way imports between features', async () => {
    const tree = {
      'src/features/auth/index.ts': '',
      'src/features/users/index.ts': "export { Login } from '@/features/auth'",
      'src/app/router.tsx': "import { u } from '@/features/users'",
    };
    expect(await check(tree, { appFiles: 'app' })).toEqual([]);
  });
});

describe('alias setup', () => {
  const tsconfig = (paths?: Record<string, string[]>) =>
    JSON.stringify({ compilerOptions: paths ? { paths } : {}, include: ['src'] });
  const viteWith = (resolve: string) => `export default defineConfig({\n  plugins: [],\n  ${resolve}\n})\n`;
  const pkg = (vite: string) => JSON.stringify({ devDependencies: { vite } });

  it('warns when tsconfig and the Vite config miss the alias', async () => {
    const tree = { 'src/main.tsx': '', 'tsconfig.app.json': tsconfig(), 'vite.config.ts': viteWith(''), 'package.json': pkg('^8.0.0') };
    const issues = await check(tree, { appFiles: 'root' });
    expect(summary(issues)).toEqual([
      'warning alias-not-configured tsconfig.app.json',
      'warning alias-not-configured vite.config.ts',
    ]);
    expect(issues[0]?.hint).toBe('Run "reactsmith init" to set it up, or change "alias" in reactsmith.config.json.');
  });

  it('accepts tsconfigPaths on Vite 8, or resolve.alias on any version', async () => {
    const base = { 'src/main.tsx': '', 'tsconfig.app.json': tsconfig({ '@/*': ['./src/*'] }) };
    const withTsconfigPaths = { ...base, 'vite.config.ts': viteWith('resolve: { tsconfigPaths: true },'), 'package.json': pkg('^8.0.0') };
    expect(await check(withTsconfigPaths, { appFiles: 'root' })).toEqual([]);

    const resolveAlias = "resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },";
    expect(await check({ ...base, 'vite.config.ts': viteWith(resolveAlias), 'package.json': pkg('^6.0.0') }, { appFiles: 'root' })).toEqual([]);
  });

  it('does not accept tsconfigPaths on Vite before 8', async () => {
    const tree = {
      'src/main.tsx': '',
      'tsconfig.app.json': tsconfig({ '@/*': ['./src/*'] }),
      'vite.config.ts': viteWith('resolve: { tsconfigPaths: true },'),
      'package.json': pkg('^7.0.0'),
    };
    expect(summary(await check(tree, { appFiles: 'root' }))).toEqual(['warning alias-not-configured vite.config.ts']);
  });

  it('reports a tsconfig alias pointing elsewhere', async () => {
    const tree = { 'src/main.tsx': '', 'tsconfig.json': tsconfig({ '@/*': ['./lib/*'] }) };
    const issues = await check(tree, { appFiles: 'root' });
    expect(summary(issues)).toEqual(['warning alias-mismatch tsconfig.json']);
    expect(issues[0]?.message).toBe('tsconfig.json maps "@/*" to ["./lib/*"], but reactsmith.config.json expects ["./src/*"].');
  });

  it('skips configs it cannot read, and everything when the alias is disabled', async () => {
    const unreadable = { 'src/main.tsx': '', 'vite.config.ts': 'export default defineConfig(() => ({ plugins: [] }))' };
    expect(await check(unreadable, { appFiles: 'root' })).toEqual([]);
    expect(await check({ 'src/main.tsx': '', 'tsconfig.json': tsconfig() }, { appFiles: 'root', alias: null })).toEqual([]);
  });
});

it('stops at config errors without checking the structure', async () => {
  const issues = await check({ 'src/services/': '' }, { folders: { features: null } });
  expect(summary(issues)).toEqual([`error config-invalid ${CONFIG_FILE}`]);
});
