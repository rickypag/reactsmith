import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { checkCodeFolders } from './code-folders.js';
import { codes, examples } from './examples.js';

describe('code folders: examples', () => {
  testExamples(checkCodeFolders, examples, codes);
});
