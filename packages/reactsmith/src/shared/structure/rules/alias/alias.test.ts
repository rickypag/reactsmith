import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { checkAlias } from './alias.js';
import { codes, examples } from './examples.js';

describe('alias: examples', () => {
  testExamples(checkAlias, examples, codes);
});
