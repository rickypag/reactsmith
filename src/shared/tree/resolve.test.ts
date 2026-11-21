import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config/validate.js';
import type { FolderTree } from './types.js';

function treeOf(raw: Record<string, unknown> = {}): FolderTree {
  const { config, issues } = validateConfig(raw);
  if (!config) throw new Error(issues.map((issue) => issue.message).join(' '));
  return config.tree;
}

const names = (place: { folders: { name: string }[] }) => place.folders.map((folder) => folder.name);

describe('tree: the default', () => {
  it('has the three places with their default folders', () => {
    const tree = treeOf();
    expect(tree.srcDir).toBe('src');
    expect(names(tree.src)).toEqual(['app', 'assets', 'components', 'config', 'features', 'hooks', 'lib', 'stores', 'testing', 'types', 'utils']);
    expect(tree.app?.path).toBe('src/app');
    expect(names(tree.app!)).toEqual(['components', 'layouts', 'styles', 'views']);
    expect(tree.features.path).toBe('src/features');
    expect(names(tree.features.feature)).toEqual(['assets', 'components', 'hooks', 'layouts', 'stores', 'types', 'utils', 'views']);
  });

  it('says what each folder holds, leaving the rest free', () => {
    const holds = Object.fromEntries(treeOf().src.folders.map((folder) => [folder.name, folder.holds]));
    expect(holds).toMatchObject({ app: 'app', features: 'features', components: 'components', hooks: 'code', assets: 'free', lib: 'free' });
  });

  it('has the router file in the app, and the public API and routes files in each feature', () => {
    const tree = treeOf();
    expect(tree.app?.files).toEqual([{ role: 'router', path: 'router.tsx', requiredWithRouter: true }]);
    expect(tree.features.feature.files).toEqual([
      { role: 'publicApi', path: 'index.ts', requiredWithRouter: false },
      { role: 'routes', path: 'routes.tsx', requiredWithRouter: true },
    ]);
  });
});

describe('tree: from the config', () => {
  it('uses the names and srcDir of the config, keeping each role', () => {
    const tree = treeOf({ srcDir: 'app/src', folders: { features: 'modules' }, featureFolders: { views: 'pages' } });
    expect(tree.features.path).toBe('app/src/modules');
    expect(tree.src.folders.find((folder) => folder.role === 'features')).toEqual({ role: 'features', name: 'modules', holds: 'features' });
    expect(tree.features.feature.folders.find((folder) => folder.role === 'views')).toEqual({ role: 'views', name: 'pages', holds: 'views' });
  });

  it('adds folders as free, and leaves out disabled ones', () => {
    const tree = treeOf({ featureFolders: { scripts: 'scripts', stores: null } });
    expect(tree.features.feature.folders.find((folder) => folder.name === 'scripts')?.holds).toBe('free');
    expect(names(tree.features.feature)).not.toContain('stores');
  });

  it('has no app place when the app folder is disabled', () => {
    expect(treeOf({ folders: { app: null } }).app).toBeUndefined();
  });

  it('leaves out the files the config disables, and keeps nested paths', () => {
    const tree = treeOf({ appRouter: null, featurePublicApi: null, featureRoutes: 'routes/index.tsx', imports: { featurePublicApiOnly: false } });
    expect(tree.app?.files).toEqual([]);
    expect(tree.features.feature.files).toEqual([{ role: 'routes', path: 'routes/index.tsx', requiredWithRouter: true }]);
  });
});
