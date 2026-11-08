import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { createProject, VITE_TREE } from '../helpers.js';

/** Component folder and file placement rules are left out: these tests use loose component files as fixtures (see components.test.ts). */
async function check(tree: Record<string, string>, config: unknown = {}) {
  const root = await createProject(tree, config);
  return (await checkStructure(root)).issues.filter((issue) => !issue.code.startsWith('component-') && issue.code !== 'file-misplaced');
}

function summary(issues: { severity: string; code: string; path?: string }[]): string[] {
  return issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path ?? ''}`.trim());
}

describe('fresh Vite project', () => {
  it('also warns that the config is missing when there is none', async () => {
    const root = await createProject(VITE_TREE);
    const { issues } = await checkStructure(root);
    expect(summary(issues)).toEqual([`warning config-missing ${CONFIG_FILE}`, 'warning app-files-undecided src']);
  });
});

describe('feature files', () => {
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
      'warning feature-public-api-missing src/features/auth',
      'error feature-deep-import src/main.tsx',
    ]);
    expect(issues[0]?.message).toBe(
      'Feature "auth" has no public API file index.ts, other code can only reach it through deep imports.',
    );
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
