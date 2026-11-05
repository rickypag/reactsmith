import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkViews } from './views.js';

const run = (tree: Record<string, string>, config?: Record<string, unknown>) => runRule(checkViews, tree, { appFiles: 'app', ...config });

describe('views: examples', () => {
  testExamples(checkViews, examples, codes);
});

describe('views', () => {
  it('follows a custom view suffix, or none', async () => {
    expect(await run({ 'src/app/views/SettingsPage/SettingsPage.tsx': '', 'src/app/views/SettingsPage/index.ts': '' }, { viewSuffix: 'Page' })).toEqual([]);
    expect(await run({ 'src/app/views/Settings/Settings.tsx': '', 'src/app/views/Settings/index.ts': '' }, { viewSuffix: '' })).toEqual([]);
  });

  it('does not accept the suffix alone as a name', async () => {
    expect(summary(await run({ 'src/app/views/View/View.tsx': '' }))).toEqual(['error view-naming src/app/views/View']);
  });

  it('does not look inside a folder it reports for its name', async () => {
    expect(summary(await run({ 'src/app/views/settings/hooks/': '' }))).toEqual(['error view-naming src/app/views/settings']);
  });

  it('points tests to tests/', async () => {
    const issues = await run({ 'src/app/views/HomeView/HomeView.tsx': '', 'src/app/views/HomeView/index.ts': '', 'src/app/views/HomeView/HomeView.test.tsx': '' });
    expect(issues[0]?.hint).toBe('Move it to src/app/views/HomeView/tests/HomeView.test.tsx.');
  });
});
