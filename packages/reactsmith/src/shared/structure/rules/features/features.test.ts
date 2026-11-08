import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkFeatures } from './features.js';

describe('features: examples', () => {
  testExamples(checkFeatures, examples, codes);
});

describe('features', () => {
  it('says when a feature without a public API is reached through deep imports', async () => {
    const tree = { 'src/features/docs/components/Toc/Toc.tsx': '', 'src/main.tsx': "import { Toc } from '@/features/docs/components/Toc';\n" };
    const issues = await runRule(checkFeatures, tree, { appFiles: 'app', alias: '@' });
    expect(summary(issues)).toEqual(['warning feature-public-api-missing src/features/docs']);
    expect(issues[0]?.message).toBe('Feature "docs" has no public API file index.ts, other code can only reach it through deep imports.');
  });

  it('does not count imports from inside the feature', async () => {
    const tree = { 'src/features/docs/index.ts': '', 'src/features/docs/routes.tsx': "import '@/features/docs';\n" };
    expect(summary(await runRule(checkFeatures, tree, { appFiles: 'app', alias: '@' }))).toEqual(['warning feature-unused src/features/docs']);
  });
});
