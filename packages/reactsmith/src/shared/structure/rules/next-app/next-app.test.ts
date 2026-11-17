import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { checkNextApp } from './next-app.js';
import { codes, examples } from './examples.js';

describe('next app: examples', () => {
  testExamples(checkNextApp, examples, codes);
});

describe('next app', () => {
  it('leaves src/app to the app folder rules when the project is not Next', async () => {
    expect(await runRule(checkNextApp, { 'src/app/DocCard.tsx': '' })).toEqual([]);
  });

  it('accepts every kind of route folder, and numbered icons', async () => {
    const tree = {
      'src/app/@modal/(.)photo/[id]/page.tsx': '',
      'src/app/shop/[[...slug]]/page.tsx': '',
      'src/app/icon1.png': '',
      'src/app/sitemap.ts': '',
      'src/app/docs/page.module.css': '',
      'src/app/.gitkeep': '',
    };
    expect(await runRule(checkNextApp, tree, { framework: 'next' })).toEqual([]);
  });

  it('reports a private folder once, without what it holds', async () => {
    const issues = await runRule(checkNextApp, { 'src/app/_lib/format.ts': '', 'src/app/_lib/helpers/x.tsx': '' }, { framework: 'next' });
    expect(summary(issues)).toEqual(['error next-private-folder src/app/_lib']);
  });
});
