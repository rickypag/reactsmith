import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { checkFolderStructure } from './folder-structure.js';
import { codes, examples } from './examples.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkFolderStructure, tree, config);

describe('folder structure: examples', () => {
  testExamples(checkFolderStructure, examples, codes);
});

describe('folder structure: the top of src', () => {
  const config = { appFiles: 'root' };

  it('accepts every default folder and loose files', async () => {
    const tree = Object.fromEntries(
      ['app', 'assets', 'components', 'config', 'features', 'hooks', 'lib', 'stores', 'testing', 'types', 'utils'].map((name) => [`src/${name}/`, '']),
    );
    expect(await run({ ...tree, 'src/main.tsx': '', 'src/vite-env.d.ts': '' }, config)).toEqual([]);
  });

  it('follows unknownFolders: "warn" and "allow"', async () => {
    expect(summary(await run({ 'src/services/': '' }, { ...config, unknownFolders: 'warn' }))).toEqual(['warning unknown-folder src/services']);
    expect(await run({ 'src/services/': '' }, { ...config, unknownFolders: 'allow' })).toEqual([]);
  });

  it('accepts added and renamed folders, and rejects the old name', async () => {
    const custom = { ...config, folders: { features: 'apps', services: 'services' } };
    expect(await run({ 'src/apps/': '', 'src/services/': '' }, custom)).toEqual([]);
    expect(summary(await run({ 'src/features/': '' }, custom))).toEqual(['error unknown-folder src/features']);
  });

  it('rejects disabled folders', async () => {
    expect(summary(await run({ 'src/stores/': '' }, { ...config, folders: { stores: null } }))).toEqual(['error unknown-folder src/stores']);
  });

  it('uses a custom srcDir', async () => {
    expect(await run({ 'app/src/components/': '' }, { ...config, srcDir: 'app/src' })).toEqual([]);
    expect(summary(await run({ 'src/components/': '' }, { ...config, srcDir: 'app/src' }))).toEqual(['error src-missing app/src']);
  });
});

describe('folder structure: shared components', () => {
  const config = { appFiles: 'app' };

  it('follows the unknownFolders policy', async () => {
    expect(summary(await run({ 'src/components/widgets/': '' }, { ...config, unknownFolders: 'warn' }))).toEqual(['warning unknown-component-type src/components/widgets']);
    expect(await run({ 'src/components/widgets/': '' }, { ...config, unknownFolders: 'allow' })).toEqual([]);
  });

  it('accepts types added to componentTypes, and suggests the type a name only differs from by case', async () => {
    expect(await run({ 'src/components/charts/': '' }, { ...config, componentTypes: { data: ['charts'] } })).toEqual([]);
    const issues = await run({ 'src/components/Buttons/': '' }, config);
    expect(summary(issues)).toEqual(['error unknown-component-type src/components/Buttons']);
    expect(issues[0]?.hint).toBe('Folder names are case-sensitive: rename it to "buttons".');
  });
});

describe('folder structure: the app folder', () => {
  const config = { appFiles: 'app' };

  it('accepts folders added to appFolders', async () => {
    expect(await run({ 'src/app/widgets/': '' }, { ...config, appFolders: { widgets: 'widgets' } })).toEqual([]);
  });

  it('follows the unknownFolders policy', async () => {
    expect(summary(await run({ 'src/app/widgets/': '' }, { ...config, unknownFolders: 'warn' }))).toEqual(['warning unknown-app-folder src/app/widgets']);
  });

  it('allows the folder of a nested router file', async () => {
    expect(await run({ 'src/app/routing/router.tsx': '' }, { ...config, appRouter: 'routing/router.tsx' })).toEqual([]);
  });
});

describe('folder structure: features', () => {
  const config = { appFiles: 'root' };

  it('accepts kebab-case features with known folders', async () => {
    const tree = {
      'src/features/auth/components/LoginForm.tsx': '',
      'src/features/auth/stores/': '',
      'src/features/user-profile/hooks/': '',
      'src/features/user-profile/index.ts': '',
    };
    expect(await run(tree, config)).toEqual([]);
  });

  it('enforces camelCase when configured', async () => {
    const camel = { ...config, featureNaming: 'camelCase' };
    expect(await run({ 'src/features/userProfile/': '' }, camel)).toEqual([]);
    const issues = await run({ 'src/features/user-profile/': '' }, camel);
    expect(summary(issues)).toEqual(['error feature-naming src/features/user-profile']);
    expect(issues[0]?.hint).toContain('"userProfile"');
  });

  it('accepts folders added to featureFolders', async () => {
    expect(await run({ 'src/features/auth/constants/': '' }, { ...config, featureFolders: { constants: 'constants' } })).toEqual([]);
  });

  it('allows the folder of a nested feature file', async () => {
    const tree = { 'src/features/auth/routes/index.tsx': '' };
    expect(summary(await run(tree, config))).toEqual(['error unknown-feature-folder src/features/auth/routes']);
    expect(await run(tree, { ...config, featureRoutes: 'routes/index.tsx' })).toEqual([]);
  });

  it('leaves loose files in the features folder to other checks', async () => {
    expect(await run({ 'src/features/index.ts': '' }, config)).toEqual([]);
  });

  it('checks the renamed features folder', async () => {
    expect(summary(await run({ 'src/apps/Auth/': '' }, { ...config, folders: { features: 'apps' } }))).toEqual(['error feature-naming src/apps/Auth']);
  });

});
