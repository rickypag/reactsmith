import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChangeSet, type FileMove } from '../../src/shared/changes.js';
import { planMove } from '../../src/shared/imports/move.js';
import { findSpecifiers } from '../../src/shared/imports/specifiers.js';
import { IssueError } from '../../src/shared/issues.js';
import { createProject, exists, read, VITE_TREE } from '../helpers.js';

describe('findSpecifiers', () => {
  it('finds every kind of import with exact positions', () => {
    const text = [
      "import a from './a'",
      'import type { B } from "@/b"',
      "export * from './c.js'",
      "const d = import('./d?raw')",
      "const e = require('./e')",
      "import './side.css'",
      "const f = 'not-an-import'",
    ].join('\n');
    const specifiers = findSpecifiers(text);
    expect(specifiers.map((s) => s.value)).toEqual(['./a', '@/b', './c.js', './d?raw', './e', './side.css']);
    for (const s of specifiers) expect(text.slice(s.start, s.end)).toBe(s.value);
  });
});

async function move(tree: Record<string, string>, moves: [string, string][], alias = '@') {
  const root = await createProject(tree);
  const requests: FileMove[] = moves.map(([from, to]) => ({ from: path.join(root, from), to: path.join(root, to) }));
  const changes = new ChangeSet(root);
  const plan = await planMove(changes, { srcDir: path.join(root, 'src'), alias }, requests);
  await changes.apply();
  return { root, plan, changes };
}

describe('planMove', () => {
  it('moves the Vite App files and rewrites imports in both directions', async () => {
    const { root, plan } = await move(VITE_TREE, [
      ['src/App.tsx', 'src/app/App.tsx'],
      ['src/App.css', 'src/app/App.css'],
    ]);

    expect(await exists(root, 'src/App.tsx')).toBe(false);
    expect(await read(root, 'src/main.tsx')).toContain("import App from './app/App.tsx'");
    const app = await read(root, 'src/app/App.tsx');
    expect(app).toContain("import heroImg from '../assets/hero.png'");
    expect(app).toContain("import reactLogo from '../assets/react.svg'");
    expect(app).toContain("import './App.css'");
    expect(plan.updates.map((u) => `${u.from} → ${u.to}`)).toEqual([
      './assets/hero.png → ../assets/hero.png',
      './assets/react.svg → ../assets/react.svg',
      './App.tsx → ./app/App.tsx',
    ]);
  });

  it('keeps the original style: extensions, alias, index folders, .js and query suffixes', async () => {
    const { root } = await move(
      {
        'src/components/Button/Button.tsx': 'export const Button = 1',
        'src/components/Button/index.ts': "export * from './Button'",
        'src/pages/home.tsx': [
          "import { Button } from '../components/Button'",
          "import { Button as B2 } from '../components/Button/Button.tsx'",
          "import { Button as B3 } from '../components/Button/Button.js'",
          "import { Button as B4 } from '@/components/Button/Button'",
          "import raw from '../components/Button/Button.tsx?raw'",
        ].join('\n'),
      },
      [['src/components/Button', 'src/features/ui/components/Button']],
    );

    expect(await read(root, 'src/pages/home.tsx')).toBe(
      [
        "import { Button } from '../features/ui/components/Button'",
        "import { Button as B2 } from '../features/ui/components/Button/Button.tsx'",
        "import { Button as B3 } from '../features/ui/components/Button/Button.js'",
        "import { Button as B4 } from '@/features/ui/components/Button/Button'",
        "import raw from '../features/ui/components/Button/Button.tsx?raw'",
      ].join('\n'),
    );
    // Imports inside the moved folder are unchanged, and the old folder is gone.
    expect(await read(root, 'src/features/ui/components/Button/index.ts')).toBe("export * from './Button'");
    expect(await exists(root, 'src/components/Button')).toBe(false);
  });

  it('keeps alias imports when the importing file moves', async () => {
    const { root } = await move(
      { 'src/lib/api.ts': '', 'src/Page.tsx': "import { api } from '@/lib/api'\nimport x from './lib/api'" },
      [['src/Page.tsx', 'src/pages/Page.tsx']],
    );
    expect(await read(root, 'src/pages/Page.tsx')).toBe("import { api } from '@/lib/api'\nimport x from '../lib/api'");
  });

  it('ignores packages, unknown aliases and files outside the move', async () => {
    const tree = {
      'src/a.ts': '',
      'src/b.ts': "import React from 'react'\nimport x from '~/a'\nimport y from './missing'",
      'src/c.ts': "import a from './a'",
    };
    const { root, plan } = await move(tree, [['src/b.ts', 'src/sub/b.ts']]);
    expect(plan.updates).toEqual([]);
    expect(await read(root, 'src/c.ts')).toBe("import a from './a'");
  });

  it('reports moves and import updates as actions', async () => {
    const { changes } = await move(VITE_TREE, [['src/App.tsx', 'src/app/App.tsx']]);
    expect(changes.actions.map((a) => `${a.type} ${a.path} ${a.message}`)).toEqual([
      'move src/App.tsx → src/app/App.tsx',
      'update src/app/App.tsx import "./assets/hero.png" → "../assets/hero.png"',
      'update src/app/App.tsx import "./assets/react.svg" → "../assets/react.svg"',
      'update src/app/App.tsx import "./App.css" → "../App.css"',
      'update src/main.tsx import "./App.tsx" → "./app/App.tsx"',
    ]);
  });

  it('scans files outside src, such as root tests', async () => {
    const { root } = await move({ 'src/a.ts': '', 'tests/a.test.ts': "import a from '../src/a'" }, [
      ['src/a.ts', 'src/lib/a.ts'],
    ]);
    expect(await read(root, 'tests/a.test.ts')).toBe("import a from '../src/lib/a'");
  });

  it('refuses to overwrite or to move missing files', async () => {
    const root = await createProject({ 'src/a.ts': '', 'src/b.ts': '' });
    const ctx = { srcDir: path.join(root, 'src'), alias: '@' };
    const changes = new ChangeSet(root);
    await expect(planMove(changes, ctx, [{ from: path.join(root, 'src/a.ts'), to: path.join(root, 'src/b.ts') }])).rejects.toThrow(
      IssueError,
    );
    await expect(planMove(changes, ctx, [{ from: path.join(root, 'src/x.ts'), to: path.join(root, 'src/y.ts') }])).rejects.toThrow(
      'does not exist',
    );
    expect(changes.hasChanges).toBe(false);
  });
});
