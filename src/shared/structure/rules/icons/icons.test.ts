import { describe, expect, it } from 'vitest';
import { runRule, testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkIcons } from './icons.js';

describe('icons: examples', () => {
  testExamples(checkIcons, examples, codes);
});

describe('icons', () => {
  it('checks nothing without an icon library in the config', async () => {
    expect(await runRule(checkIcons, { 'src/app/App.tsx': "import { FaSearch } from 'react-icons/fa';\n" }, { appFiles: 'app' })).toEqual([]);
  });
});
