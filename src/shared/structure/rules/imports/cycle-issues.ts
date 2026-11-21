import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { findFeatureCycles, type FeatureGraph } from '../../cycles.js';

/** Features that import each other in a loop, which keeps them from being understood or removed one at a time. */
export function cycleIssues(config: ResolvedConfig, graph: FeatureGraph): Issue[] {
  return findFeatureCycles(graph).map((loop) => ({
    severity: 'warning',
    code: 'feature-cycle',
    path: config.tree.features.path,
    message: `Features import each other in a loop: ${loop.join(' → ')}.`,
    hint: 'Move what they share into a shared folder or a separate feature, merge them, or pass it in (e.g. as props) so only one side imports the other.',
  }));
}
