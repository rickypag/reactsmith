import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';
import { isNext } from '../framework/detect.js';
import { addPathAlias, TSCONFIG_FILES } from './tsconfig.js';
import { addViteAlias, VITE_CONFIG_FILES } from './vite.js';

/** The first of `names` that exists, with its content (as planned so far in `changes`). */
export async function readFirst(changes: ChangeSet, names: string[]): Promise<{ name: string; text: string } | undefined> {
  for (const name of names) {
    const text = await changes.read(name);
    if (text !== undefined) return { name, text };
  }
  return undefined;
}

async function planTsconfigAlias(changes: ChangeSet, alias: string, srcDir: string): Promise<void> {
  const pattern = `"${alias}/*"`;
  const tsconfig = await readFirst(changes, TSCONFIG_FILES);
  if (!tsconfig) {
    changes.skip(TSCONFIG_FILES[0]!, `no tsconfig found, ${pattern} not configured`);
    return;
  }
  const result = addPathAlias(tsconfig.text, alias, srcDir);
  if (result.status === 'added') {
    changes.write(tsconfig.name, result.text, { type: 'update', message: `added paths ${pattern} → "./${srcDir}/*"` });
  } else if (result.status === 'exists') {
    changes.skip(tsconfig.name, `paths ${pattern} already configured`);
  } else {
    changes.skip(tsconfig.name, `paths ${pattern} already points to ${JSON.stringify(result.existing)}, left unchanged`);
  }
}

async function planViteAlias(changes: ChangeSet, alias: string, srcDir: string): Promise<void> {
  const vite = await readFirst(changes, VITE_CONFIG_FILES);
  if (!vite) {
    changes.skip(VITE_CONFIG_FILES[0]!, 'no Vite config found, alias not configured');
    return;
  }
  const viteMajor = await dependencyMajor(changes.root, 'vite');
  const result = addViteAlias(vite.text, vite.name, {
    alias,
    srcDir,
    useTsconfigPaths: viteMajor !== undefined && viteMajor >= 8,
  });
  if (result.status === 'added') {
    changes.write(vite.name, result.text, { type: 'update', message: result.description });
  } else if (result.status === 'exists') {
    changes.skip(vite.name, 'alias already configured');
  } else {
    changes.skip(vite.name, `configure the alias manually: ${result.reason}`);
  }
}

/**
 * Plans the import alias (e.g. "@/components/Button") in tsconfig and the Vite config. Next.js reads the paths of
 * tsconfig itself, so a Next app only needs tsconfig. Safe to run again.
 */
export async function planAliasSetup(changes: ChangeSet, config: ResolvedConfig): Promise<void> {
  if (!config.alias) {
    changes.skip(CONFIG_FILE, 'import alias is disabled ("alias": null)');
    return;
  }
  await planTsconfigAlias(changes, config.alias, config.srcDir);
  if (!isNext(config)) await planViteAlias(changes, config.alias, config.srcDir);
}
