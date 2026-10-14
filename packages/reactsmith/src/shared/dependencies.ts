import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Version of a package installed in the project's node_modules, or in a parent's (workspaces hoist them). */
async function installedVersion(root: string, name: string): Promise<string | undefined> {
  let dir = path.resolve(root);
  for (;;) {
    const pkg = await readJson(path.join(dir, 'node_modules', name, 'package.json'));
    if (typeof pkg?.version === 'string') return pkg.version;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Major version of a dependency of the project: the installed version if available,
 * otherwise the first number of the range in package.json (e.g. "^7.9.0" → 7).
 * Undefined when the project does not depend on it.
 */
export async function dependencyMajor(root: string, name: string): Promise<number | undefined> {
  const pkg = await readJson(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies as object), ...(pkg?.devDependencies as object) } as Record<string, unknown>;
  const range = deps[name];
  if (typeof range !== 'string') return undefined;

  const version = (await installedVersion(root, name)) ?? range;
  const major = /\d+/.exec(version)?.[0];
  return major === undefined ? undefined : Number.parseInt(major, 10);
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
];

/** The project's package manager, from the nearest lockfile (workspaces keep it at the root). Defaults to npm. */
export async function detectPackageManager(root: string): Promise<PackageManager> {
  let dir = path.resolve(root);
  for (;;) {
    for (const [lockfile, manager] of LOCKFILES) {
      if (await access(path.join(dir, lockfile)).then(() => true, () => false)) return manager;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return 'npm';
    dir = parent;
  }
}

/** The command that adds a dependency, e.g. "npm install react-router" or "pnpm add react-router". */
export function installCommand(manager: PackageManager, spec: string): string {
  return manager === 'npm' ? `npm install ${spec}` : `${manager} add ${spec}`;
}
