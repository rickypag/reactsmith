import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { checkRepeatedShell } from '../../layout-chain.js';
import { checkRouteTargets } from '../../route-targets.js';
import { checkRouter } from '../../router.js';
import { appRouterIssues } from './app-router-issues.js';
import { featureRoutesIssues } from './feature-routes-issues.js';

/**
 * Routing: when the project has a router, the app has its router file and each feature its routes file, where the
 * tree says; the router is only created in the app router, and routes files only hold routes; a route renders a
 * view; and a layout does not repeat the shell of the layout around it.
 */
export async function checkRouting(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return [
    ...(await appRouterIssues(root, config)),
    ...(await featureRoutesIssues(root, config)),
    ...(await checkRouter(root, config)),
    ...(await checkRouteTargets(root, config)),
    ...(await checkRepeatedShell(root, config)),
  ];
}
