import { TYPOGRAPHY } from '../../../shared/tokens/typography.js';
import { tokenCommand } from '../tokens.js';

export const styleTypographyCommand = tokenCommand(
  TYPOGRAPHY,
  'typography',
  'family/sans=Inter, sans-serif; size/heading/base=1.5rem; weight/heading={weight.semibold}',
  'Typography',
);
