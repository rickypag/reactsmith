import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { appRouterIssues } from './app-router-issues.js';
import { featureRoutesIssues } from './feature-routes-issues.js';

/**
 * Routing: when the project has a router, the app has its router file and each feature its routes file, where the
 * tree says. The other routing checks (router.ts, route-targets.ts, layout-chain.ts) join this rule later.
 */
export async function checkRouting(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return [...(await appRouterIssues(root, config)), ...(await featureRoutesIssues(root, config))];
}
