import { ChangeSet } from '../changes.js';
import { CONFIG_FILE, TOOL_NAME } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { dependencyMajor } from '../dependencies.js';
import { isNext } from '../framework/detect.js';
import type { Issue } from '../issues.js';
import { readFirst } from './setup.js';
import { addPathAlias, TSCONFIG_FILES } from './tsconfig.js';
import { addViteAlias, VITE_CONFIG_FILES } from './vite.js';

/**
 * Warns when the import alias from the config is missing from tsconfig or the Vite config (not in a Next.js app),
 * e.g. after someone edited them by hand. Files that do not exist are not checked.
 */
export async function checkAliasSetup(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.alias) return [];
  const { alias, srcDir } = config;
  // Only used to read files: nothing is planned or written.
  const files = new ChangeSet(root);
  const issues: Issue[] = [];
  const pattern = `"${alias}/*"`;
  const fix = `Run "${TOOL_NAME} init" to set it up, or change "alias" in ${CONFIG_FILE}.`;

  const tsconfig = await readFirst(files, TSCONFIG_FILES);
  if (tsconfig) {
    const result = addPathAlias(tsconfig.text, alias, srcDir);
    if (result.status === 'added') {
      issues.push({
        severity: 'warning',
        code: 'alias-not-configured',
        path: tsconfig.name,
        message: `The import alias "${alias}/" is not set up: ${tsconfig.name} has no compilerOptions.paths ${pattern}.`,
        hint: fix,
      });
    } else if (result.status === 'conflict') {
      issues.push({
        severity: 'warning',
        code: 'alias-mismatch',
        path: tsconfig.name,
        message: `${tsconfig.name} maps ${pattern} to ${JSON.stringify(result.existing)}, but ${CONFIG_FILE} expects ["./${srcDir}/*"].`,
        hint: `Update the paths entry, or change "alias" or "srcDir" in ${CONFIG_FILE}.`,
      });
    }
  }

  // Next.js reads the alias from tsconfig: a Vite config there (e.g. for Vitest) is not the app's.
  const vite = isNext(config) ? undefined : await readFirst(files, VITE_CONFIG_FILES);
  if (vite) {
    const viteMajor = await dependencyMajor(root, 'vite');
    const viaTsconfigPaths = addViteAlias(vite.text, vite.name, { alias, srcDir, useTsconfigPaths: true }).status;
    const viaResolveAlias = addViteAlias(vite.text, vite.name, { alias, srcDir, useTsconfigPaths: false }).status;
    // resolve.tsconfigPaths only exists in Vite 8+; when the version is unknown, either setup counts.
    const tsconfigPathsWork = viteMajor === undefined || viteMajor >= 8;
    const configured = (tsconfigPathsWork && viaTsconfigPaths === 'exists') || viaResolveAlias === 'exists';
    // "manual" means the config could not be read (e.g. defineConfig with a function): don't guess.
    const unreadable = viaTsconfigPaths === 'manual' && viaResolveAlias === 'manual';
    if (!configured && !unreadable) {
      issues.push({
        severity: 'warning',
        code: 'alias-not-configured',
        path: vite.name,
        message: `The import alias "${alias}/" is not set up in ${vite.name}.`,
        hint: fix,
      });
    }
  }
  return issues;
}
