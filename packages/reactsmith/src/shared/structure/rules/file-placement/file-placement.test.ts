import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { checkFilePlacement } from './file-placement.js';
import { codes, examples } from './examples.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkFilePlacement, tree, config);

describe('file placement: examples', () => {
  testExamples(checkFilePlacement, examples, codes);
});

describe('file placement', () => {
  const config = { appFiles: 'app' };

  it('leaves dotfiles alone everywhere', async () => {
    const tree = { 'src/features/.DS_Store': '', 'src/app/views/.gitkeep': '', 'src/components/buttons/.gitkeep': '' };
    expect(await run(tree, config)).toEqual([]);
  });

  it('leaves code folders, free folders and the top of src alone', async () => {
    const tree = { 'src/main.tsx': '', 'src/index.css': '', 'src/utils/format.ts': '', 'src/lib/client.ts': '', 'src/app/styles/global.css': '' };
    expect(await run(tree, config)).toEqual([]);
  });

  it('allows the App files in the app folder before "appFiles" is set', async () => {
    expect(await run({ 'src/app/App.tsx': '' })).toEqual([]);
  });

  it('follows the configured place files', async () => {
    const custom = { ...config, featurePublicApi: 'public.ts', featureRoutes: 'routes/index.tsx', appRouter: 'routing/router.tsx' };
    const tree = { 'src/features/docs/public.ts': '', 'src/features/docs/index.ts': '', 'src/app/router.tsx': '' };
    expect(summary(await run(tree, custom))).toEqual(['error file-misplaced src/app/router.tsx', 'error file-misplaced src/features/docs/index.ts']);
  });

  it('reports tests at the root of a feature: they sit next to what they test', async () => {
    const tree = { 'src/features/users/index.ts': '', 'src/features/users/users.test.ts': '' };
    expect(summary(await run(tree, config))).toEqual(['error file-misplaced src/features/users/users.test.ts']);
  });

  it('skips folders that are not a type of shared components', async () => {
    expect(await run({ 'src/components/widgets/Thing.tsx': '' }, config)).toEqual([]);
  });

  it('checks renamed unit folders under their new names', async () => {
    const tree = { 'src/features/docs/index.ts': '', 'src/features/docs/pages/Loose.tsx': '' };
    expect(summary(await run(tree, { ...config, featureFolders: { views: 'pages' } }))).toEqual(['error file-misplaced src/features/docs/pages/Loose.tsx']);
  });
});
