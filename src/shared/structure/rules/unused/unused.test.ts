import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkUnusedCode } from './unused.js';

describe('unused: examples', () => {
  testExamples(checkUnusedCode, examples, codes);
});
