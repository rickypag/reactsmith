import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { propsTypeIssues } from './props-type-issues.js';

/**
 * Typing: how the project's types are used. A component's props type (`ProductCardProps`) types only props: the
 * component's own, and those of other components. Data has types of its own.
 * Not this rule's: what a types/ folder may hold (code-folders), importing past its index.ts (imports), what a
 * component file holds (components).
 */
export async function checkTyping(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return propsTypeIssues(root, config);
}
