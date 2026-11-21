import type { ChangeSet } from '../changes.js';
import { REACT_ROUTER_VERSIONS, TOOL_NAME } from '../config/defaults.js';
import type { ResolvedConfig, RouterConfig } from '../config/types.js';
import { dependencyMajor, detectPackageManager, installCommand } from '../dependencies.js';

export type RouterDetection =
  | { status: 'found'; router: RouterConfig }
  | { status: 'missing' }
  | { status: 'unsupported'; reason: string };

/**
 * Finds the router the project depends on. React Router 7 ships both "react-router" and
 * the compatibility package "react-router-dom"; either one counts.
 * Data mode is the only supported mode for now, so it is the one recorded.
 */
export async function detectRouter(root: string): Promise<RouterDetection> {
  const version = (await dependencyMajor(root, 'react-router')) ?? (await dependencyMajor(root, 'react-router-dom'));
  if (version === undefined) return { status: 'missing' };
  if (!(REACT_ROUTER_VERSIONS as readonly number[]).includes(version)) {
    return {
      status: 'unsupported',
      reason: `React Router ${version} is not supported yet (supported: ${REACT_ROUTER_VERSIONS.join(', ')})`,
    };
  }
  return { status: 'found', router: { library: 'react-router', version, mode: 'data' } };
}

/**
 * The router settings to save in the config: undefined when the config already has them,
 * or when no supported router is installed (which is reported as a skipped step).
 */
export async function planRouterDetection(changes: ChangeSet, config: ResolvedConfig): Promise<RouterConfig | undefined> {
  if (config.router) return undefined;
  const detection = await detectRouter(changes.root);
  if (detection.status === 'found') return detection.router;
  const manager = await detectPackageManager(changes.root);
  const latest = REACT_ROUTER_VERSIONS[REACT_ROUTER_VERSIONS.length - 1];
  const message =
    detection.status === 'missing'
      ? `React Router not found, routing not configured. To use routing, run "${installCommand(manager, 'react-router')}"`
      : `${detection.reason}, routing not configured. To upgrade, run "${installCommand(manager, `react-router@${latest}`)}"`;
  changes.skip('package.json', `${message}, then "${TOOL_NAME} init" again`);
  return undefined;
}
