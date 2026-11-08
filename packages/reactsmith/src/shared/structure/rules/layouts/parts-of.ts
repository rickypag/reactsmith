import type { TreeUnit } from '../../../tree/types.js';

/**
 * Where the parts of a layout go: the components of its owner. With `article`, "the app components" (for a sentence
 * of its own), without, "app components" (after "in").
 */
export function partsOf(unit: TreeUnit, article = true): string {
  const parts = 'feature' in unit.owner ? `components of feature "${unit.owner.feature}"` : 'app components';
  return article ? `the ${parts}` : parts;
}
