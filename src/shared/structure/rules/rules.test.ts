import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FOLDER_CONTENTS } from '../../tree/default.js';
import type { FolderContent } from '../../tree/types.js';
import { RULES } from './rules.js';

const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The rule that checks inside each kind of folder; null for the folders the check leaves alone. */
const OWNERS: Record<FolderContent, string | null> = {
  app: 'folder-structure',
  features: 'folder-structure',
  views: 'views',
  components: 'components',
  layouts: 'layouts',
  code: 'code-folders',
  free: null,
  next: 'next-app',
};

async function codesOf(rule: string): Promise<readonly string[]> {
  const { codes } = (await import(`./${rule}/examples.ts`)) as { codes: readonly string[] };
  return codes;
}

describe('rules', () => {
  it('has a folder for every rule, and a rule for every folder', async () => {
    const folders = (await readdir(RULES_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(folders.sort()).toEqual(RULES.map((rule) => rule.name).sort());
  });

  it('gives every code to exactly one rule', async () => {
    const owners = new Map<string, string[]>();
    for (const { name } of RULES) for (const code of await codesOf(name)) owners.set(code, [...(owners.get(code) ?? []), name]);
    expect([...owners].filter(([, rules]) => rules.length > 1)).toEqual([]);
  });

  it('gives every kind of folder of the tree a rule that checks inside it', () => {
    const names = RULES.map((rule) => rule.name);
    const kinds = new Set<FolderContent>([...Object.values(FOLDER_CONTENTS), 'free', 'next']);
    for (const kind of kinds) {
      const owner = OWNERS[kind];
      if (owner !== null) expect(names).toContain(owner);
    }
  });
});
