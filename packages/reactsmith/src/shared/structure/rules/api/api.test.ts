import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { checkApi } from './api.js';
import { codes, examples } from './examples.js';

const run = (tree: Record<string, string>) => runRule(checkApi, tree, { appFiles: 'app' });

describe('api: examples', () => {
  testExamples(checkApi, examples, codes);
});

describe('api', () => {
  it('accepts units without api/, and only queries or only mutations in a component', async () => {
    expect(await run({ 'src/app/components/A/A.tsx': '', 'src/app/components/B/api/queries.ts': '', 'src/app/components/C/api/mutations.ts': '' })).toEqual([]);
  });

  it('reports a barrel in api/, and a folder alone as missing the files', async () => {
    expect(summary(await run({ 'src/components/cards/UserCard/api/index.ts': '', 'src/components/cards/UserCard/api/lib/': '' }))).toEqual([
      'error api-unexpected-file src/components/cards/UserCard/api/index.ts',
      'error api-unexpected-file src/components/cards/UserCard/api/lib',
      'error api-file-missing src/components/cards/UserCard/api',
    ]);
  });

  it('leaves the api/ of a layout to the layouts rule', async () => {
    expect(await run({ 'src/app/layouts/Shell/api/': '' })).toEqual([]);
  });
});
