import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkTokens } from './tokens.js';

describe('tokens: examples', () => {
  testExamples(checkTokens, examples, codes);
});
