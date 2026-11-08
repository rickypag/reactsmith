import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkStyles } from './styles.js';

describe('styles: examples', () => {
  testExamples(checkStyles, examples, codes);
});
