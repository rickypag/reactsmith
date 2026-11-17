import type { ChangeSet } from '../changes.js';
import type { Framework, ResolvedConfig } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';

/** Whether the project is a Next.js app: Next routes the pages, so ReactSmith creates and checks no router. */
export function isNext(config: Pick<ResolvedConfig, 'framework'>): boolean {
  return config.framework === 'next';
}

/**
 * The framework the project depends on: Next.js first, since a Next app may also have Vite as a dev tool
 * (e.g. through Vitest), then Vite. Undefined when neither is installed.
 */
export async function detectFramework(root: string): Promise<Framework | undefined> {
  if ((await dependencyMajor(root, 'next')) !== undefined) return 'next';
  if ((await dependencyMajor(root, 'vite')) !== undefined) return 'vite';
  return undefined;
}

/**
 * The framework of the project, and whether init should save it: the config's when it sets one (the dev's choice
 * wins), else the one found in package.json.
 */
export async function planFrameworkDetection(changes: ChangeSet, config: ResolvedConfig): Promise<{ framework?: Framework; save: boolean }> {
  if (config.framework) return { framework: config.framework, save: false };
  const framework = await detectFramework(changes.root);
  return { framework, save: framework !== undefined };
}
