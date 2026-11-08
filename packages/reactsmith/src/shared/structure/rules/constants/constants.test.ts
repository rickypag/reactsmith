import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { checkConstants } from './constants.js';
import { codes, examples } from './examples.js';

describe('constants: examples', () => {
  testExamples(checkConstants, examples, codes);
});
