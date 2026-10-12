import { readFileSync } from 'node:fs';

/**
 * Version of the installed ReactSmith package.
 * The path is relative to this file, which sits at the same depth in src/ and dist/.
 */
export function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}
