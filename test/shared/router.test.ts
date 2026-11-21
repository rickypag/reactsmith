import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dependencyMajor, detectPackageManager, installCommand } from '../../src/shared/dependencies.js';
import { detectRouter } from '../../src/shared/router/detect.js';
import { createProject } from '../helpers.js';

function project(deps: Record<string, string>, devDeps: Record<string, string> = {}, installed: Record<string, string> = {}) {
  const tree: Record<string, string> = {
    'package.json': JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  };
  for (const [name, version] of Object.entries(installed)) {
    tree[`node_modules/${name}/package.json`] = JSON.stringify({ version });
  }
  return createProject(tree);
}

describe('dependencyMajor', () => {
  it('reads the range from dependencies or devDependencies', async () => {
    expect(await dependencyMajor(await project({ vite: '^8.3.0' }), 'vite')).toBe(8);
    expect(await dependencyMajor(await project({}, { vite: '~7.1.2' }), 'vite')).toBe(7);
    expect(await dependencyMajor(await project({}), 'vite')).toBeUndefined();
  });

  it('prefers the installed version', async () => {
    expect(await dependencyMajor(await project({ vite: 'latest' }, {}, { vite: '8.0.1' }), 'vite')).toBe(8);
  });

  it('returns undefined for a range without a version', async () => {
    expect(await dependencyMajor(await project({ vite: 'latest' }), 'vite')).toBeUndefined();
  });
});

describe('detectRouter', () => {
  it('finds React Router 7', async () => {
    expect(await detectRouter(await project({ 'react-router': '^7.9.0' }))).toEqual({
      status: 'found',
      router: { library: 'react-router', version: 7, mode: 'data' },
    });
  });

  it('reports missing and unsupported versions', async () => {
    expect(await detectRouter(await project({ react: '^19.0.0' }))).toEqual({ status: 'missing' });
    expect(await detectRouter(await project({ 'react-router-dom': '^6.0.0' }))).toMatchObject({ status: 'unsupported' });
  });
});

describe('detectPackageManager', () => {
  it.each([
    ['package-lock.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
  ])('detects %s as %s', async (lockfile, manager) => {
    expect(await detectPackageManager(await createProject({ [lockfile]: '' }))).toBe(manager);
  });

  it('finds the lockfile of a workspace root', async () => {
    const root = await createProject({ 'yarn.lock': '', 'apps/docs/package.json': '{}' });
    expect(await detectPackageManager(path.join(root, 'apps/docs'))).toBe('yarn');
  });
});

describe('installCommand', () => {
  it('uses the syntax of each package manager', () => {
    expect(installCommand('npm', 'react-router')).toBe('npm install react-router');
    expect(installCommand('pnpm', 'react-router@7')).toBe('pnpm add react-router@7');
  });
});
