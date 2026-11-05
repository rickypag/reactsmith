import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { listFiles, toRelative } from '../src/shared/files.js';
import { findSpecifiers } from '../src/shared/imports/specifiers.js';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The layer a source file belongs to, e.g. "core", "shared", "command:init", "host:cli". */
function layerOf(relPath: string): string {
  const [top, second] = relPath.split('/');
  if (relPath === 'cli.ts') return 'entry';
  if (relPath === 'commands/index.ts') return 'registry';
  if (top === 'commands') return `command:${second}`;
  if (top === 'hosts') return `host:${second}`;
  return top!.replace(/\.ts$/, '');
}

/**
 * Who may import whom:
 * - core is the contract and depends on nothing
 * - shared holds the scripts
 * - a command uses core and shared, never another command or a host
 * - a host runs commands it is given, so it never imports them
 * - the entry file wires everything together
 */
function isAllowed(from: string, to: string): boolean {
  if (from === to || from === 'entry') return true;
  if (from === 'core') return false;
  if (to === 'core') return true;
  if (from === 'registry') return to.startsWith('command:');
  return to === 'shared';
}

it('respects the dependency rules between core, shared, commands and hosts', async () => {
  const violations: string[] = [];
  for (const file of await listFiles(SRC)) {
    const from = toRelative(SRC, file);
    // Tests sit next to the rules they test, but are not part of the layers: they may use the test helpers.
    if (from.endsWith('.test.ts')) continue;
    for (const { value } of findSpecifiers(await readFile(file, 'utf8'))) {
      if (!value.startsWith('.')) continue;
      const to = toRelative(SRC, path.resolve(path.dirname(file), value)).replace(/\.js$/, '.ts');
      if (!isAllowed(layerOf(from), layerOf(to))) violations.push(`${from} → ${to}`);
    }
  }
  expect(violations).toEqual([]);
});

it('flags a forbidden import', () => {
  expect(isAllowed('command:init', 'command:check')).toBe(false);
  expect(isAllowed('command:init', 'host:cli')).toBe(false);
  expect(isAllowed('host:cli', 'command:init')).toBe(false);
  expect(isAllowed('shared', 'command:init')).toBe(false);
  expect(isAllowed('core', 'shared')).toBe(false);
  expect(isAllowed('command:init', 'shared')).toBe(true);
});
