import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { scanImports } from '../../imports.js';
import { cycleIssues } from './cycle-issues.js';

/**
 * Imports: what each file of srcDir may import. Dependencies go one way (shared folders → features → app), a unit
 * (component, view, layout, code folder) is reached only through its entry point, a feature only through its public
 * API, views and layouts only from routes, and features don't import each other in a loop. Tests, stories and the
 * testing folder are exempt. Not this rule's: whether a feature is used (features).
 */
export async function checkImports(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const scan = await scanImports(root, config);
  return [...scan.issues, ...cycleIssues(config, scan.graph)];
}
