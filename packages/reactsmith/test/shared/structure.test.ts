import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { createProject, VITE_TREE } from '../helpers.js';

async function check(tree: Record<string, string>, config: unknown = {}) {
  const root = await createProject(tree, config);
  return (await checkStructure(root)).issues;
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

  it('accepts kebab-case features with known subfolders', async () => {
    const tree = {
      'src/features/auth/components/LoginForm.tsx': '',
      'src/features/auth/api/': '',
      'src/features/user-profile/hooks/': '',
      'src/features/user-profile/index.ts': '',
    };
    expect(await check(tree, config)).toEqual([]);
  });

  it('enforces kebab-case by default', async () => {
    const issues = await check({ 'src/features/userProfile/': '' }, config);
    expect(summary(issues)).toEqual(['error feature-naming src/features/userProfile']);
    expect(issues[0]?.hint).toContain('"user-profile"');
  });

  it('enforces camelCase when configured', async () => {
    const camel = { ...config, featureNaming: 'camelCase' };
    expect(await check({ 'src/features/userProfile/': '' }, camel)).toEqual([]);
    const issues = await check({ 'src/features/user-profile/': '' }, camel);
    expect(summary(issues)).toEqual(['error feature-naming src/features/user-profile']);
    expect(issues[0]?.hint).toContain('"userProfile"');
  });

  it('reports unknown feature subfolders and accepts configured ones', async () => {
    expect(summary(await check({ 'src/features/auth/constants/': '' }, config))).toEqual([
      'error unknown-feature-folder src/features/auth/constants',
    ]);
    expect(
      await check({ 'src/features/auth/constants/': '' }, { ...config, featureFolders: { constants: 'constants' } }),
    ).toEqual([]);
  });

  it('reports files directly inside the features folder', async () => {
    expect(summary(await check({ 'src/features/index.ts': '' }, config))).toEqual([
      'error unexpected-file src/features/index.ts',
    ]);
  });

  it('checks the renamed features folder', async () => {
    const renamed = { ...config, folders: { features: 'apps' } };
    expect(summary(await check({ 'src/apps/Auth/': '' }, renamed))).toEqual(['error feature-naming src/apps/Auth']);
  });
});

it('stops at config errors without checking the structure', async () => {
  const issues = await check({ 'src/services/': '' }, { folders: { features: null } });
  expect(summary(issues)).toEqual([`error config-invalid ${CONFIG_FILE}`]);
});
