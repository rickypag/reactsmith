import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { runInit } from '../../src/commands/init/init.js';
import { createProject, exists, read, VITE_PROJECT } from '../helpers.js';

function actions(result: Awaited<ReturnType<typeof runInit>>): string[] {
  return result.actions.map((action) => `${action.type} ${action.path}`);
}

describe('runInit on a fresh Vite project', () => {
  it('moves the App files and sets everything up with --app-files app', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'app' });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(actions(result)).toEqual([
      `create ${CONFIG_FILE}`,
      'move src/App.css',
      'move src/App.tsx',
      'update src/app/App.tsx',
      'update src/app/App.tsx',
      'update src/main.tsx',
      'update tsconfig.app.json',
      'update vite.config.ts',
    ]);

    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'app' });
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
    expect(await exists(root, 'src/app/App.css')).toBe(true);
    expect(await read(root, 'src/main.tsx')).toContain("import App from './app/App.tsx'");
    expect(await read(root, 'src/app/App.tsx')).toContain("from '../assets/hero.png'");
    expect(await read(root, 'tsconfig.app.json')).toContain('"@/*"');
    // No Vite installed in the temp project, so the portable resolve.alias is used.
    expect(await read(root, 'vite.config.ts')).toContain("'@': fileURLToPath(new URL('./src', import.meta.url))");
  });

  it('is idempotent: a second run changes nothing', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    const before = await Promise.all(['src/main.tsx', 'tsconfig.app.json', 'vite.config.ts', CONFIG_FILE].map((f) => read(root, f)));

    const second = await runInit(root);
    expect(second.ok).toBe(true);
    expect(second.actions.every((action) => action.type === 'skip')).toBe(true);
    const after = await Promise.all(['src/main.tsx', 'tsconfig.app.json', 'vite.config.ts', CONFIG_FILE].map((f) => read(root, f)));
    expect(after).toEqual(before);
  });

  it('keeps the App files with --app-files root', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'root' });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'root' });
  });

  it('asks when interactive, and saves the answer', async () => {
    const root = await createProject(VITE_PROJECT);
    const confirm = vi.fn().mockResolvedValue(false);
    await runInit(root, { confirm });
    expect(confirm).toHaveBeenCalledWith('Move App.css, App.tsx into src/app/?');
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ appFiles: 'root' });
  });

  it('uses the default (app) with --yes', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { yes: true });
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
  });

  it('fails without prompting when it cannot ask', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root);
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(['app-files-required']);
    expect(await exists(root, CONFIG_FILE)).toBe(false);
  });

  it('writes nothing with --dry-run', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await runInit(root, { appFiles: 'app', dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.actions.length).toBeGreaterThan(0);
    expect(await exists(root, CONFIG_FILE)).toBe(false);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
    expect(await read(root, 'vite.config.ts')).toBe(VITE_PROJECT['vite.config.ts']);
  });
});

describe('runInit with an existing config', () => {
  it('adds appFiles without touching the rest of the file', async () => {
    const root = await createProject(VITE_PROJECT);
    await writeFile(path.join(root, CONFIG_FILE), '{\n  "folders": { "features": "apps" }\n}\n');
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE))).toEqual({ folders: { features: 'apps' }, appFiles: 'root' });
  });

  it('moves the App files when the config already says "app"', async () => {
    const root = await createProject(VITE_PROJECT, { appFiles: 'app' });
    const result = await runInit(root);
    expect(result.ok).toBe(true);
    expect(await exists(root, 'src/app/App.tsx')).toBe(true);
    expect(result.actions).toContainEqual(expect.objectContaining({ type: 'skip', path: CONFIG_FILE }));
  });

  it('refuses a conflicting --app-files', async () => {
    const root = await createProject(VITE_PROJECT, { appFiles: 'root' });
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.issues.map((issue) => issue.code)).toEqual(['app-files-conflict']);
  });

  it('stops on an invalid config', async () => {
    const root = await createProject(VITE_PROJECT, { folders: { features: null } });
    const result = await runInit(root, { appFiles: 'app' });
    expect(result.ok).toBe(false);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
  });

  it('skips the alias when it is disabled', async () => {
    const root = await createProject(VITE_PROJECT, { alias: null });
    await runInit(root, { appFiles: 'root' });
    expect(await read(root, 'tsconfig.app.json')).toBe(VITE_PROJECT['tsconfig.app.json']);
    expect(await read(root, 'vite.config.ts')).toBe(VITE_PROJECT['vite.config.ts']);
  });

  it('refuses to overwrite an existing app/App.tsx', async () => {
    const root = await createProject({ ...VITE_PROJECT, 'src/app/App.tsx': '' }, { appFiles: 'app' });
    const result = await runInit(root);
    expect(result.issues.map((issue) => issue.code)).toEqual(['move-failed']);
    expect(await exists(root, 'src/App.tsx')).toBe(true);
  });
});
