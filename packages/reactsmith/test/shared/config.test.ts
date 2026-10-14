import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { loadConfig } from '../../src/shared/config/load.js';
import { validateConfig } from '../../src/shared/config/validate.js';
import { createProject } from '../helpers.js';

function codes(raw: unknown): string[] {
  return validateConfig(raw).issues.map((issue) => `${issue.severity}:${issue.message}`);
}

describe('validateConfig', () => {
  it('resolves the defaults from an empty config', () => {
    const { config, issues } = validateConfig({});
    expect(issues).toEqual([]);
    expect(config).toMatchObject({
      srcDir: 'src',
      featureNaming: 'kebab-case',
      unknownFolders: 'error',
    });
    expect(config?.folders.features).toBe('features');
    expect(config?.featureFolders.components).toBe('components');
    expect(config?.appFiles).toBeUndefined();
  });

  it('renames, disables and adds folders', () => {
    const { config, issues } = validateConfig({
      folders: { features: 'apps', stores: null, services: 'services' },
      featureFolders: { constants: 'constants', stores: null },
    });
    expect(issues).toEqual([]);
    expect(config?.folders.features).toBe('apps');
    expect(config?.folders).not.toHaveProperty('stores');
    expect(config?.folders.services).toBe('services');
    expect(config?.featureFolders.constants).toBe('constants');
    expect(config?.featureFolders).not.toHaveProperty('stores');
  });

  it('defaults the alias to "@", accepts others and null', () => {
    expect(validateConfig({}).config?.alias).toBe('@');
    expect(validateConfig({ alias: '~' }).config?.alias).toBe('~');
    expect(validateConfig({ alias: null }).config?.alias).toBeUndefined();
  });

  it('resolves the routing and feature defaults', () => {
    const { config } = validateConfig({});
    expect(config?.router).toBeUndefined();
    expect(config?.appFolders).toEqual({ components: 'components' });
    expect(config?.featurePublicApi).toBe('index.ts');
    expect(config?.featureRoutes).toBe('routes.tsx');
    expect(config?.imports).toEqual({ featurePublicApiOnly: true, featuresImportApp: false });
  });

  it('accepts customized routing and feature settings', () => {
    const { config, issues } = validateConfig({
      router: { library: 'react-router', version: 7, mode: 'data' },
      appFolders: { components: 'shell', providers: 'providers' },
      featurePublicApi: './public.ts',
      featureRoutes: 'routes\\index.tsx',
      imports: { featuresImportApp: true },
    });
    expect(issues).toEqual([]);
    expect(config?.router).toEqual({ library: 'react-router', version: 7, mode: 'data' });
    expect(config?.appFolders).toEqual({ components: 'shell', providers: 'providers' });
    expect(config?.featurePublicApi).toBe('public.ts');
    expect(config?.featureRoutes).toBe('routes/index.tsx');
    expect(config?.imports).toEqual({ featurePublicApiOnly: true, featuresImportApp: true });
  });

  it('disables the feature files with null', () => {
    const { config } = validateConfig({
      featureRoutes: null,
      featurePublicApi: null,
      imports: { featurePublicApiOnly: false },
    });
    expect(config?.featureRoutes).toBeUndefined();
    expect(config?.featurePublicApi).toBeUndefined();
  });

  it('normalizes srcDir', () => {
    expect(validateConfig({ srcDir: './app/src/' }).config?.srcDir).toBe('app/src');
  });

  it.each([
    [{ folders: { features: null } }, '"folders.features" is required'],
    [{ folders: { components: null } }, '"folders.components" is required'],
    [{ featureFolders: { components: null } }, '"featureFolders.components" is required'],
    [{ folders: { hooks: 'shared' , utils: 'shared' } }, 'both use the folder name "shared"'],
    [{ folders: { hooks: 'Components' } }, 'both use the folder name'],
    [{ folders: { hooks: 'a/b' } }, 'invalid folder name'],
    [{ folders: { hooks: 42 } }, 'must be a folder name or null'],
    [{ folders: [] }, '"folders" must be an object'],
    [{ srcDir: '../src' }, '"srcDir" must be a folder inside the project'],
    [{ srcDir: 'C:/src' }, '"srcDir" must be a folder inside the project'],
    [{ featureNaming: 'snake_case' }, '"featureNaming" must be one of'],
    [{ unknownFolders: 'ignore' }, '"unknownFolders" must be one of'],
    [{ appFiles: 'src' }, '"appFiles" must be one of'],
    [{ appFiles: 'app', folders: { app: null } }, '"folders.app" is disabled'],
    [{ feature: {} }, 'Unknown key "feature"'],
    [{ alias: '@/' }, '"alias" must be an import prefix'],
    [{ alias: './src' }, '"alias" must be an import prefix'],
    [{ alias: 1 }, '"alias" must be an import prefix'],
    [{ router: 'react-router' }, '"router" must be an object'],
    [{ router: { library: 'tanstack', version: 7, mode: 'data' } }, '"router.library" must be one of "react-router"'],
    [{ router: { library: 'react-router', version: 6, mode: 'data' } }, '"router.version" must be a supported major version: 7'],
    [{ router: { library: 'react-router', version: 7, mode: 'declarative' } }, '"router.mode" must be one of "data"'],
    [{ router: { library: 'react-router', version: 7, mode: 'data', ssr: true } }, 'Unknown key "router.ssr"'],
    [{ appFolders: { components: 'a/b' } }, '"appFolders.components" has an invalid folder name'],
    [{ featureRoutes: 'routes.css' }, '"featureRoutes" must be a .ts, .tsx, .js or .jsx file'],
    [{ featureRoutes: '../routes.tsx' }, '"featureRoutes" must be a .ts, .tsx, .js or .jsx file'],
    [{ featurePublicApi: 42 }, '"featurePublicApi" must be a file path inside the feature'],
    [{ featurePublicApi: 'index.ts', featureRoutes: 'index.ts' }, 'cannot be the same file'],
    [{ featurePublicApi: null }, '"imports.featurePublicApiOnly" needs a public API file'],
    [{ imports: { featurePublicApiOnly: 'yes' } }, '"imports.featurePublicApiOnly" must be true or false'],
    [{ imports: { deepImports: false } }, 'Unknown key "imports.deepImports"'],
    ['nope', 'must be a JSON object'],
  ])('rejects %j', (raw, expected) => {
    const { config, issues } = validateConfig(raw);
    expect(config).toBeUndefined();
    expect(issues.map((issue) => issue.message).join('\n')).toContain(expected);
  });

  it('warns when disabling a folder that is not a default', () => {
    expect(codes({ folders: { services: null } })).toEqual([expect.stringMatching(/^warning:.*nothing to disable/)]);
  });
});

describe('loadConfig', () => {
  it('falls back to defaults with a warning when the file is missing', async () => {
    const root = await createProject({});
    const result = await loadConfig(root);
    expect(result.found).toBe(false);
    expect(result.config?.folders.features).toBe('features');
    expect(result.issues.map((issue) => issue.code)).toEqual(['config-missing']);
  });

  it('reports invalid JSON', async () => {
    const root = await createProject({});
    await writeFile(path.join(root, CONFIG_FILE), '{ "srcDir": ');
    const result = await loadConfig(root);
    expect(result.config).toBeUndefined();
    expect(result.issues[0]?.code).toBe('config-invalid-json');
  });

  it('accepts a file with a UTF-8 BOM', async () => {
    const root = await createProject({});
    await writeFile(path.join(root, CONFIG_FILE), '\uFEFF{ "featureNaming": "camelCase" }');
    const result = await loadConfig(root);
    expect(result.config?.featureNaming).toBe('camelCase');
  });
});
