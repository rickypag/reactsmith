import { describe, expect, it } from 'vitest';
import { runRule, summary, testExamples } from '../../../../../test/rules.js';
import { VITE_TREE } from '../../../../../test/helpers.js';
import { checkAppFiles } from './app-files.js';
import { codes, examples } from './examples.js';

describe('app files: examples', () => {
  testExamples(checkAppFiles, examples, codes);
});

describe('app files: a fresh Vite project', () => {
  it('only warns that appFiles is undecided, listing every App file', async () => {
    const issues = await runRule(checkAppFiles, VITE_TREE);
    expect(summary(issues)).toEqual(['warning app-files-undecided src']);
    expect(issues[0]?.message).toBe('App.css, App.tsx are in src/ and "appFiles" is not set.');
  });

  it('passes with appFiles: "root"', async () => {
    expect(await runRule(checkAppFiles, VITE_TREE, { appFiles: 'root' })).toEqual([]);
  });

  it('says nothing when src is missing: that is the folder structure rule', async () => {
    expect(await runRule(checkAppFiles, { 'source/App.tsx': '' })).toEqual([]);
  });
});
