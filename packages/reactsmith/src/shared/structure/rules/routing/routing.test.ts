import { describe, expect, it } from 'vitest';
import { runRule, testExamples } from '../../../../../test/rules.js';
import { checkRouting } from './routing.js';
import { codes, examples } from './examples.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkRouting, tree, config);
const router = { library: 'react-router', version: 7, mode: 'data' };

describe('routing: examples', () => {
  testExamples(checkRouting, examples, codes);
});

describe('routing: the router file', () => {
  const config = { appFiles: 'app' };

  it('is not required without a router, or when appRouter is null', async () => {
    expect(await run({ 'src/app/App.tsx': '' }, config)).toEqual([]);
    expect(await run({ 'src/app/App.tsx': '' }, { ...config, router, appRouter: null })).toEqual([]);
  });

  it('can be nested', async () => {
    expect(await run({ 'src/app/routing/router.tsx': '' }, { ...config, router, appRouter: 'routing/router.tsx' })).toEqual([]);
  });

  it('is not required when the app folder is disabled', async () => {
    expect(await run({ 'src/main.tsx': '' }, { appFiles: 'root', router, folders: { app: null } })).toEqual([]);
  });
});

describe('routing: the routes file of a feature', () => {
  const tree = { 'src/app/router.tsx': '', 'src/features/auth/index.ts': '' };

  it('is not required without a router', async () => {
    expect(await run(tree, { appFiles: 'app' })).toEqual([]);
  });

  it('can be nested', async () => {
    expect(await run({ ...tree, 'src/features/auth/routes/index.tsx': '' }, { appFiles: 'app', router, featureRoutes: 'routes/index.tsx' })).toEqual([]);
  });

  it('ignores loose files in the features folder', async () => {
    expect(await run({ 'src/app/router.tsx': '', 'src/features/index.ts': '' }, { appFiles: 'app', router })).toEqual([]);
  });
});
