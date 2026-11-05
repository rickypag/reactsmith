import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkLayouts } from './layouts.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkLayouts, tree, { appFiles: 'app', ...config });
const layout = 'src/app/layouts/Shell';
const SHELL = { [`${layout}/Shell.tsx`]: '', [`${layout}/index.ts`]: '' };

describe('layouts: examples', () => {
  testExamples(checkLayouts, examples, codes);
});

describe('layouts', () => {
  it('does not look inside a folder it reports for its name', async () => {
    expect(summary(await run({ 'src/app/layouts/shell/parts/': '' }))).toEqual(['error layout-naming src/app/layouts/shell']);
  });

  it('allows any content in tests/ and stories/', async () => {
    expect(await run({ ...SHELL, [`${layout}/tests/fixtures/data.json`]: '', [`${layout}/stories/mock.ts`]: '' })).toEqual([]);
  });

  it('follows the configured style format', async () => {
    const issues = await run({ ...SHELL, [`${layout}/Shell.styles.ts`]: '', [`${layout}/Shell.module.css`]: '' }, { styles: 'tailwind' });
    expect(summary(issues)).toEqual([`error layout-unexpected-file ${layout}/Shell.module.css`]);
    expect(issues[0]?.hint).toBe('Styles are tailwind ("styles" in reactsmith.config.json): each layout file has its own, e.g. Shell.styles.ts for Shell.tsx.');
  });

  it('points stories to stories/', async () => {
    const issues = await run({ ...SHELL, [`${layout}/Shell.stories.tsx`]: '' });
    expect(issues[0]?.hint).toBe(`Move it to ${layout}/stories/Shell.stories.tsx.`);
  });
});
