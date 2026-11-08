import { describe } from 'vitest';
import { testExamples } from '../../../../../test/rules.js';
import { codes, examples } from './examples.js';
import { checkImports } from './imports.js';

describe('imports: examples', () => {
  testExamples(checkImports, examples, codes);
});
