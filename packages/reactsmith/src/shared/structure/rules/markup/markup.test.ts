import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkMarkup } from './markup.js';

describe('markup: examples', () => {
  testExamples(checkMarkup, examples, codes);
});
